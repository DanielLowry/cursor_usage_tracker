// Legacy Next fallback page to satisfy builds that expect a pages-based /_error
import React from 'react';

export default function LegacyError() {
  return (
    <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh'}}>
      <div style={{maxWidth: 680, padding: 24, borderRadius: 8, background: '#fff', boxShadow: '0 6px 18px rgba(0,0,0,0.06)'}}>
        <h1 style={{color: '#d32f2f', marginBottom: 8}}>Something went wrong</h1>
        <p style={{color: '#333'}}>An unexpected error occurred while rendering the page. Please try again.</p>
      </div>
    </div>
  );
}


