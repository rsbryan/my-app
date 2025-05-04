"use client";
import { useState, useEffect } from "react";
import styles from "./page.module.css";
import { supabase } from "./supabaseClient";

export default function Home() {
  // Auth state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState("sign-in"); // or "sign-up"
  const [error, setError] = useState("");

  // PDF upload state
  const [pdfFile, setPdfFile] = useState(null);
  const [uploadError, setUploadError] = useState("");
  const [pdfs, setPdfs] = useState([]);
  const [loading, setLoading] = useState(false);

  // Check for user session on mount
  useEffect(() => {
    const getSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setUser(session?.user || null);
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
  const handleSignUp = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error } = await supabase.auth.signUp({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message);
    } else {
      setError("Check your email for a confirmation link.");
    }
  };

  // Sign in
  const handleSignIn = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message);
    }
  };

  // Sign out
  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setPdfs([]);
  };

  // Upload PDF
  const handleUpload = async (e) => {
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
    setLoading(true);
    const fileExt = pdfFile.name.split('.').pop();
    const fileName = `${user.id}/${Date.now()}.${fileExt}`;
    const { error } = await supabase.storage.from('pdfs').upload(fileName, pdfFile);
    setLoading(false);
    if (error) {
      setUploadError(error.message);
    } else {
      setPdfFile(null);
      fetchPdfs();
    }
  };

  // Fetch user's PDFs
  const fetchPdfs = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase.storage.from('pdfs').list(user.id + '/', { limit: 100, offset: 0, sortBy: { column: 'name', order: 'asc' } });
    if (error) {
      setPdfs([]);
      setLoading(false);
      return;
    }
    // Get public URLs
    const pdfList = await Promise.all(
      (data || []).map(async (file) => {
        const { data: urlData } = supabase.storage.from('pdfs').getPublicUrl(`${user.id}/${file.name}`);
        return { id: file.id || file.name, name: file.name, url: urlData.publicUrl };
      })
    );
    setPdfs(pdfList);
    setLoading(false);
  };

  useEffect(() => {
    if (user) {
      fetchPdfs();
    } else {
      setPdfs([]);
    }
    // eslint-disable-next-line
  }, [user]);

  return (
    <div className={styles.page}>
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
            {error && <p style={{ color: "red" }}>{error}</p>}
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
          <>
            <div className="upload-container">
              <h2>Upload PDF</h2>
              <form onSubmit={handleUpload}>
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={(e) => setPdfFile(e.target.files[0])}
                  required
                  disabled={loading}
                />
                <button type="submit" disabled={loading}>{loading ? "Uploading..." : "Upload"}</button>
              </form>
              {uploadError && <p style={{ color: "red" }}>{uploadError}</p>}
              <button style={{ marginTop: "1rem" }} onClick={handleSignOut}>
                Sign Out
              </button>
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
                    <li key={pdf.id}>
                      <a href={pdf.url} target="_blank" rel="noopener noreferrer">
                        {pdf.name}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
