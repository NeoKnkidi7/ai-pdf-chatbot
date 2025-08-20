import os
import uuid
import aiofiles
from fastapi import FastAPI, File, UploadFile, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import List, Optional
import json
from langchain.document_loaders import PyPDFLoader
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain.embeddings import HuggingFaceEmbeddings
from langchain.vectorstores import FAISS
from langchain.llms import HuggingFaceHub
from langchain.chains import RetrievalQA
from langchain.schema import Document
import tempfile
import sqlite3
from datetime import datetime
import hashlib

app = FastAPI(title="AI PDF Chatbot API")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Change this in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize database
def init_db():
    conn = sqlite3.connect('chatbot.db')
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS documents
                 (id TEXT PRIMARY KEY, filename TEXT, uploaded_at TIMESTAMP)''')
    c.execute('''CREATE TABLE IF NOT EXISTS chats
                 (id TEXT PRIMARY KEY, document_id TEXT, question TEXT, 
                  answer TEXT, created_at TIMESTAMP)''')
    conn.commit()
    conn.close()

init_db()

# Initialize embeddings model
embeddings = HuggingFaceEmbeddings(
    model_name="sentence-transformers/all-MiniLM-L6-v2"
)

# Initialize LLM (using a free model from Hugging Face Hub)
# Note: You can get a free token at https://huggingface.co/settings/tokens
llm = HuggingFaceHub(
    repo_id="google/flan-t5-base",
    model_kwargs={"temperature": 0.1, "max_length": 512},
    huggingfacehub_api_token=os.getenv("HUGGINGFACEHUB_API_TOKEN", "")
)

# In-memory storage for vector stores (in production, use persistent storage)
vector_stores = {}

class QuestionRequest(BaseModel):
    question: str
    document_id: Optional[str] = None

class UploadResponse(BaseModel):
    message: str
    document_id: str

class ChatResponse(BaseModel):
    answer: str
    sources: List[str]
    document_id: str

def process_document(file_path: str, document_id: str):
    """Process PDF and create vector store"""
    try:
        # Load and process the PDF
        loader = PyPDFLoader(file_path)
        documents = loader.load()
        
        # Split the documents into chunks
        text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000,
            chunk_overlap=200
        )
        texts = text_splitter.split_documents(documents)
        
        # Create vector store
        vector_store = FAISS.from_documents(texts, embeddings)
        vector_stores[document_id] = vector_store
        
        # Store document info in database
        conn = sqlite3.connect('chatbot.db')
        c = conn.cursor()
        c.execute("INSERT INTO documents VALUES (?, ?, ?)", 
                 (document_id, os.path.basename(file_path), datetime.now()))
        conn.commit()
        conn.close()
        
        return True
    except Exception as e:
        print(f"Error processing document: {e}")
        return False

def save_chat(document_id: str, question: str, answer: str):
    """Save chat to database"""
    try:
        conn = sqlite3.connect('chatbot.db')
        c = conn.cursor()
        chat_id = str(uuid.uuid4())
        c.execute("INSERT INTO chats VALUES (?, ?, ?, ?, ?)", 
                 (chat_id, document_id, question, answer, datetime.now()))
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"Error saving chat: {e}")

@app.post("/upload", response_model=UploadResponse)
async def upload_pdf(file: UploadFile = File(...), background_tasks: BackgroundTasks = None):
    if file.content_type != "application/pdf":
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")
    
    # Create a temporary file
    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp_file:
        content = await file.read()
        tmp_file.write(content)
        tmp_file_path = tmp_file.name
    
    # Generate a unique document ID
    document_id = str(uuid.uuid4())
    
    # Process document in background
    if background_tasks:
        background_tasks.add_task(process_document, tmp_file_path, document_id)
    else:
        process_document(tmp_file_path, document_id)
    
    return UploadResponse(
        message="PDF is being processed. You can start asking questions shortly.",
        document_id=document_id
    )

@app.post("/ask", response_model=ChatResponse)
async def ask_question(request: QuestionRequest):
    document_id = request.document_id
    
    if document_id not in vector_stores:
        raise HTTPException(status_code=400, detail="Document not found or still processing")
    
    try:
        vector_store = vector_stores[document_id]
        
        # Create QA chain
        qa_chain = RetrievalQA.from_chain_type(
            llm=llm,
            chain_type="stuff",
            retriever=vector_store.as_retriever(search_kwargs={"k": 3}),
            return_source_documents=True
        )
        
        result = qa_chain({"query": request.question})
        
        # Extract sources
        sources = []
        for doc in result["source_documents"]:
            if hasattr(doc, 'metadata') and 'page' in doc.metadata:
                sources.append(f"Page {doc.metadata['page'] + 1}")
        
        # Save chat to database
        save_chat(document_id, request.question, result["result"])
        
        return ChatResponse(
            answer=result["result"],
            sources=sources,
            document_id=document_id
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing question: {str(e)}")

@app.get("/documents")
async def get_documents():
    """Get list of processed documents"""
    try:
        conn = sqlite3.connect('chatbot.db')
        c = conn.cursor()
        c.execute("SELECT id, filename, uploaded_at FROM documents ORDER BY uploaded_at DESC")
        documents = []
        for row in c.fetchall():
            documents.append({
                "id": row[0],
                "filename": row[1],
                "uploaded_at": row[2]
            })
        conn.close()
        return {"documents": documents}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving documents: {str(e)}")

@app.get("/chats/{document_id}")
async def get_chats(document_id: str):
    """Get chat history for a document"""
    try:
        conn = sqlite3.connect('chatbot.db')
        c = conn.cursor()
        c.execute("SELECT question, answer, created_at FROM chats WHERE document_id = ? ORDER BY created_at", 
                 (document_id,))
        chats = []
        for row in c.fetchall():
            chats.append({
                "question": row[0],
                "answer": row[1],
                "created_at": row[2]
            })
        conn.close()
        return {"chats": chats}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving chats: {str(e)}")

@app.get("/health")
async def health_check():
    return {"status": "OK"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
