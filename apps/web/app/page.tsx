// Relative path: apps/web/app/page.tsx

export default function Home() {
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-gray-900 sm:text-5xl md:text-6xl">
            Cursor Usage Tracker
          </h1>
          <p className="mt-3 max-w-md mx-auto text-base text-gray-500 sm:text-lg md:mt-5 md:text-xl md:max-w-3xl">
            Track your Cursor IDE usage and analyze your coding patterns.
          </p>
          <div className="mt-5 max-w-md mx-auto sm:flex sm:justify-center md:mt-8">
            <a
              href="/dashboard"
              className="rounded-md shadow w-full inline-flex items-center justify-center px-8 py-3 border border-transparent text-base font-medium text-white bg-blue-600 hover:bg-blue-700 md:py-4 md:text-lg md:px-10"
            >
              View Dashboard
            </a>
            <a
              href="/admin/login-helper"
              className="mt-3 rounded-md shadow w-full inline-flex items-center justify-center px-8 py-3 border border-gray-200 text-base font-medium text-blue-600 bg-white hover:bg-gray-50 md:py-4 md:text-lg md:px-10 sm:mt-0 sm:ml-3"
            >
              Login Helper
            </a>
            <a
              href="/explorer"
              className="mt-3 rounded-md shadow w-full inline-flex items-center justify-center px-8 py-3 border border-transparent text-base font-medium text-white bg-green-600 hover:bg-green-700 md:py-4 md:text-lg md:px-10 sm:mt-0 sm:ml-3"
            >
              Raw Data Explorer
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
