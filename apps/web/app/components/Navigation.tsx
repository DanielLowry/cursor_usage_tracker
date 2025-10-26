// Relative path: apps/web/app/components/Navigation.tsx

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function Navigation() {
  const pathname = usePathname();
  const [auth, setAuth] = useState<{ isAuthenticated: boolean; lastChecked?: string } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let isMounted = true;
    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/auth/status', { cache: 'no-store' });
        const data = await res.json();
        if (isMounted) setAuth({ isAuthenticated: !!data.isAuthenticated, lastChecked: data.lastChecked });
      } catch {
        if (isMounted) setAuth({ isAuthenticated: false });
      }
    };
    // initial + 30s interval
    void fetchStatus();
    const id = setInterval(() => {
      setTick((n) => n + 1);
      void fetchStatus();
    }, 30_000);
    return () => {
      isMounted = false;
      clearInterval(id);
    };
  }, []);

  const navItems = [
    { href: '/', label: 'Home' },
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/explorer', label: 'Raw Data Explorer' },
    { href: '/admin/login-helper', label: 'Login Helper' },
  ];

  return (
    <nav className="bg-white shadow-sm border-b">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex">
            <div className="flex-shrink-0 flex items-center">
              <Link href="/" className="text-xl font-bold text-gray-900">
                Cursor Usage Tracker
              </Link>
            </div>
            <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
              {navItems.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium transition-colors duration-200 ${
                      isActive
                        ? 'border-blue-500 text-gray-900'
                        : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
          <div className="hidden sm:flex items-center">
            <div
              title={auth?.lastChecked ? `Last checked: ${new Date(auth.lastChecked).toLocaleString()}` : 'Checking auth...'}
              className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${
                auth == null
                  ? 'border-gray-300 text-gray-600'
                  : auth.isAuthenticated
                    ? 'border-green-200 text-green-700 bg-green-50'
                    : 'border-red-200 text-red-700 bg-red-50'
              }`}
            >
              <span
                className={`mr-1 h-2 w-2 rounded-full ${
                  auth == null ? 'bg-gray-400 animate-pulse' : auth.isAuthenticated ? 'bg-green-500' : 'bg-red-500'
                }`}
              />
              {auth == null ? 'Checking…' : auth.isAuthenticated ? 'Authenticated' : 'Not Authenticated'}
            </div>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      <div className="sm:hidden">
        <div className="pt-2 pb-3 space-y-1">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block pl-3 pr-4 py-2 border-l-4 text-base font-medium transition-colors duration-200 ${
                  isActive
                    ? 'bg-blue-50 border-blue-500 text-blue-700'
                    : 'border-transparent text-gray-500 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-700'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
          <div className="px-4 py-2">
            <div
              className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium border ${
                auth == null
                  ? 'border-gray-300 text-gray-600'
                  : auth.isAuthenticated
                    ? 'border-green-200 text-green-700 bg-green-50'
                    : 'border-red-200 text-red-700 bg-red-50'
              }`}
            >
              <span
                className={`mr-1 h-2 w-2 rounded-full ${
                  auth == null ? 'bg-gray-400 animate-pulse' : auth.isAuthenticated ? 'bg-green-500' : 'bg-red-500'
                }`}
              />
              {auth == null ? 'Checking…' : auth.isAuthenticated ? 'Authenticated' : 'Not Authenticated'}
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}
