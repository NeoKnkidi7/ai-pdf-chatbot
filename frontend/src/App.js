import React, { useState, useRef, useEffect } from 'react';
import { FileText, Send, Upload, Loader2, MessageSquare, BookOpen } from 'lucide-react';
import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

function App() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [question, setQuestion] = useState('');
  const [activeDocument, setActiveDocument] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [conversation, setConversation] = useState([]);
  const fileInputRef = useRef(null);

  // Fetch documents on component mount
  useEffect(() => {
    fetchDocuments();
  }, []);

  // Fetch conversation when active document changes
  useEffect(() => {
    if (activeDocument) {
      fetchChats(activeDocument);
    } else {
      setConversation([]);
    }
  }, [activeDocument]);

  const fetchDocuments = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/documents`);
      setDocuments(response.data.documents || []);
    } catch (error) {
      console.error('Error fetching documents:', error);
    }
  };

  const fetchChats = async (documentId) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/chats/${documentId}`);
      setConversation(response.data.chats || []);
    } catch (error) {
      console.error('Error fetching chats:', error);
    }
  };

  const handleFileUpload = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsProcessing(true);
    const formData = new FormData();
    formData.append('file', files[0]);

    try {
      const response = await axios.post(`${API_BASE_URL}/upload`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      
      alert(response.data.message);
      // Refresh documents list
      await fetchDocuments();
      // Set the new document as active
      setActiveDocument(response.data.document_id);
    } catch (error) {
      console.error('Error uploading PDF:', error);
      alert('Failed to process PDF. Please try again.');
    } finally {
      setIsProcessing(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleAskQuestion = async (e) => {
    e.preventDefault();
    if (!question.trim() || !activeDocument) return;

    setIsLoading(true);
    const currentQuestion = question;
    setQuestion('');

    try {
      const response = await axios.post(`${API_BASE_URL}/ask`, {
        question: currentQuestion,
        document_id: activeDocument
      });
      
      setConversation(prev => [...prev, {
        question: currentQuestion,
        answer: response.data.answer,
        sources: response.data.sources
      }]);
    } catch (error) {
      console.error('Error asking question:', error);
      alert('Failed to get answer. Please make sure you have uploaded a PDF first.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        <header className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-800 mb-2 flex items-center justify-center">
            <BookOpen className="mr-3" /> AI PDF Chatbot
          </h1>
          <p className="text-gray-600">Chat with your PDF documents using AI</p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Sidebar */}
          <div className="lg:col-span-1 bg-white rounded-xl shadow-md p-6 h-fit">
            <h2 className="text-xl font-semibold text-gray-800 mb-4 flex items-center">
              <FileText className="mr-2" /> Documents
            </h2>
            
            <div className="mb-6">
              <div className="relative">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  accept=".pdf"
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  disabled={isProcessing}
                />
                <button
                  className={`w-full flex items-center justify-center px-4 py-2 rounded-lg ${
                    isProcessing 
                      ? 'bg-gray-400 cursor-not-allowed' 
                      : 'bg-blue-500 hover:bg-blue-600'
                  } text-white transition-colors`}
                  disabled={isProcessing}
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="animate-spin mr-2 h-5 w-5" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Upload className="mr-2 h-5 w-5" />
                      Upload PDF
                    </>
                  )}
                </button>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-medium text-gray-800 mb-3">Your Documents</h3>
              <div className="space-y-2">
                {documents.length === 0 ? (
                  <p className="text-gray-500 text-center py-4">No documents yet</p>
                ) : (
                  documents.map((doc) => (
                    <div
                      key={doc.id}
                      className={`p-3 rounded-lg cursor-pointer transition-colors ${
                        activeDocument === doc.id
                          ? 'bg-blue-100 border border-blue-300'
                          : 'bg-gray-100 hover:bg-gray-200'
                      }`}
                      onClick={() => setActiveDocument(doc.id)}
                    >
                      <p className="text-gray-800 font-medium truncate">{doc.filename}</p>
                      <p className="text-gray-500 text-sm">
                        {new Date(doc.uploaded_at).toLocaleDateString()}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Main Chat Area */}
          <div className="lg:col-span-2 bg-white rounded-xl shadow-md p-6">
            <h2 className="text-xl font-semibold text-gray-800 mb-6 flex items-center">
              <MessageSquare className="mr-2" /> Chat
            </h2>
            
            {!activeDocument ? (
              <div className="text-center py-12 text-gray-500">
                <FileText className="mx-auto h-12 w-12 mb-4" />
                <p>Upload a PDF or select a document to start chatting</p>
              </div>
            ) : (
              <>
                <div className="mb-6">
                  <form onSubmit={handleAskQuestion} className="flex gap-2">
                    <input
                      type="text"
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                      placeholder="Ask a question about your PDF..."
                      className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      disabled={isLoading}
                    />
                    <button
                      type="submit"
                      disabled={isLoading || !question.trim() || !activeDocument}
                      className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center"
                    >
                      {isLoading ? (
                        <Loader2 className="animate-spin h-5 w-5" />
                      ) : (
                        <Send className="h-5 w-5" />
                      )}
                    </button>
                  </form>
                </div>

                <div className="space-y-6 max-h-96 overflow-y-auto">
                  {conversation.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                      <p>Ask a question to get started with this document</p>
                    </div>
                  ) : (
                    conversation.map((item, index) => (
                      <div key={index} className="border rounded-lg p-4">
                        <div className="mb-3">
                          <p className="font-medium text-gray-800">Q: {item.question}</p>
                        </div>
                        <div className="mb-4">
                          <p className="text-gray-700">A: {item.answer}</p>
                        </div>
                        {item.sources && item.sources.length > 0 && (
                          <div>
                            <p className="text-sm font-medium text-gray-600 mb-2">Sources:</p>
                            <div className="flex flex-wrap gap-2">
                              {item.sources.map((source, idx) => (
                                <span key={idx} className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">
                                  {source}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                  {isLoading && (
                    <div className="flex justify-center py-4">
                      <Loader2 className="animate-spin h-8 w-8 text-blue-500" />
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        <footer className="text-center mt-12 text-gray-500 text-sm">
          <p>Built with React, FastAPI, LangChain, and FAISS</p>
        </footer>
      </div>
    </div>
  );
}

export default App;
