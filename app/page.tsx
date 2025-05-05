"use client";
import { useState, useEffect } from "react";
import styles from "./page.module.css";
import { supabase } from "./supabaseClient";
import { Session, User } from "@supabase/supabase-js";
import { useTheme } from "./themeContext";
import { useStats, formatBytes } from "./statsContext";

// Define types for our PDF file object
interface PdfFile {
  id: string;
  name: string;
  url: string;
}

export default function Home() {
  // Theme state
  const { theme, toggleTheme } = useTheme();
  
  // Stats state
  const { stats, updateStats, isLoading: statsLoading } = useStats();
  
  // Auth state
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [user, setUser] = useState<User | null>(null);
  const [authMode, setAuthMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [authError, setAuthError] = useState<string>("");
  const [authLoading, setAuthLoading] = useState<boolean>(true);

  // PDF upload state
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string>("");
  const [pdfs, setPdfs] = useState<PdfFile[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  
  // Edit name state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newName, setNewName] = useState<string>("");

  // Check for user session on mount
  useEffect(() => {
    const getSession = async () => {
      setAuthLoading(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        setUser(session?.user || null);
      } catch (error) {
        console.error("Error checking session:", error);
        setAuthError("Failed to check authentication status");
      } finally {
        setAuthLoading(false);
      }
    };
    getSession();
    
    // Listen for auth changes
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
    });
    
    return () => {
      listener?.subscription.unsubscribe();
    };
  }, []);

  // Sign up
  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    setLoading(true);
    try {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;
      setAuthError("Check your email for a confirmation link.");
    } catch (error: any) {
      setAuthError(error.message || "Failed to sign up");
    } finally {
      setLoading(false);
    }
  };

  // Sign in
  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } catch (error: any) {
      setAuthError(error.message || "Failed to sign in");
    } finally {
      setLoading(false);
    }
  };

  // Sign out
  const handleSignOut = async () => {
    setLoading(true);
    try {
      await supabase.auth.signOut();
      setUser(null);
      setPdfs([]);
    } catch (error: any) {
      setAuthError(error.message || "Failed to sign out");
    } finally {
      setLoading(false);
    }
  };

  // Safely extract file extension
  const getFileExtension = (filename: string): string => {
    // Handle cases with no extension
    if (!filename.includes('.')) return '';
    
    // Split by dot and get the last part, then remove query params
    return filename.split('.').pop()?.split(/[#?]/)[0] || '';
  };

  // Upload PDF
  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    setUploadError("");
    
    if (!pdfFile) {
      setUploadError("Please select a PDF file.");
      return;
    }
    
    if (!user) {
      setUploadError("You must be signed in to upload.");
      return;
    }
    
    // Validate file type
    if (!pdfFile.type.includes('pdf')) {
      setUploadError("File must be a PDF document.");
      return;
    }
    
    // Check file size (5MB limit)
    const MAX_SIZE = 5 * 1024 * 1024; // 5MB
    if (pdfFile.size > MAX_SIZE) {
      setUploadError(`File size exceeds 5MB limit (${(pdfFile.size / (1024 * 1024)).toFixed(2)}MB)`);
      return;
    }
    
    setLoading(true);
    try {
      const fileExt = getFileExtension(pdfFile.name) || 'pdf';
      const fileName = `${user.id}/${Date.now()}.${fileExt}`;
      
      const { error } = await supabase.storage
        .from('pdfs')
        .upload(fileName, pdfFile, { 
          contentType: 'application/pdf',
          upsert: false
        });
        
      if (error) throw error;
      
      setPdfFile(null);
      // Reset file input
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      if (fileInput) fileInput.value = '';
      
      await fetchPdfs();
      // Update usage stats after successful upload
      await updateStats();
    } catch (error: any) {
      setUploadError(error.message || "Failed to upload file");
      console.error("Upload error:", error);
    } finally {
      setLoading(false);
    }
  };

  // Fetch user's PDFs
  const fetchPdfs = async () => {
    if (!user) return;
    
    setLoading(true);
    try {
      console.log('Fetching PDFs for user:', user.id);
      
      // List all files in the user's folder
      const { data, error } = await supabase.storage
        .from('pdfs')
        .list(user.id + '/', { 
          limit: 100, 
          offset: 0, 
          sortBy: { column: 'name', order: 'asc' } 
        });
        
      console.log('Raw storage response:', { data, error });
      
      if (error) throw error;
      
      if (!data || data.length === 0) {
        setPdfs([]);
        console.log('No PDFs found for user:', user.id);
        return;
      }
      
      // Get public URLs for each file
      const pdfList = data.map((file) => {
        const { data: urlData } = supabase.storage
          .from('pdfs')
          .getPublicUrl(`${user.id}/${file.name}`);
          
        return { 
          id: file.id || file.name, 
          name: file.name, 
          url: urlData.publicUrl 
        };
      });
      
      setPdfs(pdfList);
      console.log('Fetched PDFs:', pdfList);
    } catch (error: any) {
      console.error('Error listing PDFs:', error.message);
      setUploadError("Failed to load your PDFs");
    } finally {
      setLoading(false);
    }
  };

  // Download PDF from a URL and save to user's bucket
  const handleDownloadAndSave = async (fileUrl: string) => {
    if (!user) {
      setAuthError("You must be signed in to save PDFs.");
      return;
    }
    
    setLoading(true);
    try {
      const response = await fetch(fileUrl);
      if (!response.ok) throw new Error("Download failed");
      
      const blob = await response.blob();
      if (!blob.type.includes('pdf')) {
        throw new Error("File is not a valid PDF");
      }
      
      const fileExt = getFileExtension(fileUrl) || 'pdf';
      const fileName = `${user.id}/${Date.now()}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from('pdfs')
        .upload(fileName, blob, { 
          contentType: 'application/pdf' 
        });
        
      if (uploadError) throw uploadError;
      
      await fetchPdfs();
      // Update usage stats after successful save
      await updateStats();
    } catch (err: any) {
      setUploadError(err.message || "Failed to save PDF");
    } finally {
      setLoading(false);
    }
  };

  // Delete PDF
  const handleDeletePdf = async (fileName: string) => {
    if (!user) return;
    
    if (!confirm("Are you sure you want to delete this file?")) {
      return;
    }
    
    setLoading(true);
    try {
      const { error } = await supabase.storage
        .from('pdfs')
        .remove([`${user.id}/${fileName}`]);
        
      if (error) throw error;
      
      // Update the UI by removing the deleted file
      setPdfs(pdfs.filter(pdf => pdf.name !== fileName));
      
      // Update usage stats after successful deletion
      await updateStats();
    } catch (error: any) {
      setUploadError(error.message || "Failed to delete file");
      console.error("Delete error:", error);
    } finally {
      setLoading(false);
    }
  };

  // Start editing PDF name
  const startEditName = (pdf: PdfFile) => {
    setEditingId(pdf.id);
    setNewName(pdf.name);
  };

  // Cancel editing
  const cancelEdit = () => {
    setEditingId(null);
    setNewName("");
  };

  // Save new PDF name
  const saveNewName = async (pdf: PdfFile) => {
    if (!user || !newName.trim()) return;
    
    setLoading(true);
    try {
      // First, copy the file with the new name
      const oldPath = `${user.id}/${pdf.name}`;
      const fileExtension = getFileExtension(pdf.name);
      const newFileName = `${newName.trim()}${fileExtension ? `.${fileExtension}` : ''}`;
      const newPath = `${user.id}/${newFileName}`;
      
      // Get the file from storage
      const { data: fileData, error: downloadError } = await supabase.storage
        .from('pdfs')
        .download(oldPath);
        
      if (downloadError) throw downloadError;
      
      // Upload with new name
      const { error: uploadError } = await supabase.storage
        .from('pdfs')
        .upload(newPath, fileData, { 
          contentType: 'application/pdf',
          upsert: false
        });
        
      if (uploadError) throw uploadError;
      
      // Delete the old file
      const { error: deleteError } = await supabase.storage
        .from('pdfs')
        .remove([oldPath]);
        
      if (deleteError) throw deleteError;
      
      // Update UI and reset state
      cancelEdit();
      await fetchPdfs();
    } catch (error: any) {
      setUploadError(error.message || "Failed to rename file");
      console.error("Rename error:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) {
      fetchPdfs();
      updateStats();
    } else {
      setPdfs([]);
    }
    // eslint-disable-next-line
  }, [user]);

  // If we're still checking authentication, show loading
  if (authLoading) {
    return (
      <div className={styles.page}>
        <main className={styles.main}>
          <div className="auth-container">
            <h2>Loading...</h2>
          </div>
        </main>
      </div>
    );
  }

  // Theme toggle button
  const ThemeToggleButton = () => (
    <button 
      className="theme-toggle" 
      onClick={toggleTheme} 
      aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
    >
      {theme === 'light' ? '🌙' : '☀️'}
    </button>
  );

  // Usage stats component
  const UsageStats = () => {
    if (!user) return null;
    
    return (
      <div className="stats-panel">
        <h3>Usage Analytics</h3>
        {statsLoading ? (
          <p>Loading statistics...</p>
        ) : (
          <div className="stats-container">
            <div className="stat-card">
              <div className="stat-value">{stats.totalFiles}</div>
              <div className="stat-label">Files</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{formatBytes(stats.totalStorage)}</div>
              <div className="stat-label">Storage Used</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{formatBytes(stats.avgFileSize)}</div>
              <div className="stat-label">Avg. File Size</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">
                {stats.lastUpload 
                  ? new Date(stats.lastUpload).toLocaleDateString() 
                  : 'N/A'}
              </div>
              <div className="stat-label">Last Upload</div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={styles.page}>
      <ThemeToggleButton />
      <main className={styles.main}>
        {!user ? (
          <div className="auth-container">
            <h2>{authMode === "sign-in" ? "Sign In" : "Sign Up"}</h2>
            <form onSubmit={authMode === "sign-in" ? handleSignIn : handleSignUp}>
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
              />
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
              />
              <button type="submit" disabled={loading}>
                {loading ? "Loading..." : authMode === "sign-in" ? "Sign In" : "Sign Up"}
              </button>
            </form>
            {authError && <p style={{ color: "red" }}>{authError}</p>}
            <p style={{ marginTop: "1rem" }}>
              {authMode === "sign-in" ? (
                <>
                  Don't have an account?{' '}
                  <button type="button" onClick={() => setAuthMode("sign-up")}>Sign Up</button>
                </>
              ) : (
                <>
                  Already have an account?{' '}
                  <button type="button" onClick={() => setAuthMode("sign-in")}>Sign In</button>
                </>
              )}
            </p>
          </div>
        ) : (
          <div className="dashboard">
            <div className="upload-container">
              <div className="user-info" style={{ marginBottom: '1rem' }}>
                <p>Logged in as: <strong>{user.email}</strong></p>
                <button 
                  style={{ marginTop: "0.5rem" }} 
                  onClick={handleSignOut}
                  disabled={loading}
                >
                  Sign Out
                </button>
              </div>
              
              <UsageStats />
              
              <h2>Upload PDF</h2>
              <form onSubmit={handleUpload}>
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={(e) => setPdfFile(e.target.files ? e.target.files[0] : null)}
                  required
                  disabled={loading}
                />
                <button type="submit" disabled={loading}>
                  {loading ? "Uploading..." : "Upload"}
                </button>
              </form>
              {uploadError && <p style={{ color: "red" }}>{uploadError}</p>}
            </div>
            <div className="upload-list">
              <h2>Your PDFs</h2>
              {loading ? (
                <p>Loading...</p>
              ) : pdfs.length === 0 ? (
                <p>No PDFs uploaded yet.</p>
              ) : (
                <ul>
                  {pdfs.map((pdf) => (
                    <li key={pdf.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      {editingId === pdf.id ? (
                        // Edit mode
                        <div className="pdf-edit-form">
                          <input
                            type="text"
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                          />
                          <div className="pdf-actions">
                            <button
                              type="button"
                              onClick={() => saveNewName(pdf)}
                              disabled={loading}
                              className="btn-save"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={cancelEdit}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        // View mode
                        <>
                          <a href={pdf.url} target="_blank" rel="noopener noreferrer" style={{ flex: '1', minWidth: '100px' }}>
                            {pdf.name}
                          </a>
                          <div className="pdf-actions">
                            <button
                              type="button"
                              onClick={() => startEditName(pdf)}
                              disabled={loading}
                              className="btn-rename"
                            >
                              Rename
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeletePdf(pdf.name)}
                              disabled={loading}
                              className="btn-delete"
                            >
                              Delete
                            </button>
                          </div>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
