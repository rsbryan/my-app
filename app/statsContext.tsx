"use client";
import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from './supabaseClient';
import { User } from '@supabase/supabase-js';

interface Stats {
  totalFiles: number;
  totalStorage: number; // in bytes
  avgFileSize: number;  // in bytes
  lastUpload: Date | null;
}

interface StatsContextType {
  stats: Stats;
  updateStats: () => Promise<void>;
  isLoading: boolean;
}

const initialStats: Stats = {
  totalFiles: 0,
  totalStorage: 0,
  avgFileSize: 0,
  lastUpload: null
};

const StatsContext = createContext<StatsContextType | undefined>(undefined);

export function StatsProvider({ children }: { children: ReactNode }) {
  const [stats, setStats] = useState<Stats>(initialStats);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  
  // Check for user session on mount
  useEffect(() => {
    const getSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        setUser(session?.user || null);
      } catch (error) {
        console.error("Error checking session:", error);
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
  
  // Update stats when user changes
  useEffect(() => {
    if (user) {
      updateStats();
    } else {
      setStats(initialStats);
    }
  }, [user]);
  
  // Function to calculate stats
  const updateStats = async () => {
    if (!user) return;
    
    setIsLoading(true);
    try {
      // Get list of files
      const { data, error } = await supabase.storage
        .from('pdfs')
        .list(user.id + '/', { 
          limit: 1000, 
          offset: 0
        });
        
      if (error) throw error;
      
      if (!data || data.length === 0) {
        setStats(initialStats);
        return;
      }
      
      // Calculate total storage and other metrics
      const totalFiles = data.length;
      const totalStorage = data.reduce((acc, file) => acc + (file.metadata?.size || 0), 0);
      const avgFileSize = totalStorage / totalFiles;
      
      // Sort by created_at to get the most recent upload
      const sortedByDate = [...data].sort((a, b) => {
        const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return dateB - dateA;
      });
      
      const lastUpload = sortedByDate.length > 0 && sortedByDate[0].created_at 
        ? new Date(sortedByDate[0].created_at) 
        : null;
      
      setStats({
        totalFiles,
        totalStorage,
        avgFileSize,
        lastUpload
      });
      
    } catch (error) {
      console.error('Error fetching stats:', error);
    } finally {
      setIsLoading(false);
    }
  };
  
  return (
    <StatsContext.Provider value={{ stats, updateStats, isLoading }}>
      {children}
    </StatsContext.Provider>
  );
}

export function useStats() {
  const context = useContext(StatsContext);
  if (context === undefined) {
    throw new Error('useStats must be used within a StatsProvider');
  }
  return context;
}

// Utility function to format bytes to human-readable format
export function formatBytes(bytes: number, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
} 