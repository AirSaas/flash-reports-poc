import { useState } from 'react'

interface HeaderProps {
  onReset: () => void
}

export function Header({ onReset }: HeaderProps) {
  const [showConfirm, setShowConfirm] = useState(false)

  return (
    <header className="bg-white border-b border-gray-200 px-4 py-3">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">Flash Report POC <img src="/mini.png" alt="AirSaas" className="h-6" /></h1>
          <p className="text-sm text-gray-600">AirSaas Portfolio Report Generator</p>
        </div>
        <div className="flex items-center gap-3">
          {showConfirm ? (
            <>
              <span className="text-sm text-gray-600">Are you sure?</span>
              <button
                onClick={() => { setShowConfirm(false); onReset() }}
                className="text-sm text-white bg-red-600 hover:bg-red-700 px-4 py-2 rounded transition-colors font-medium"
              >
                Yes, reset
              </button>
              <button
                onClick={() => setShowConfirm(false)}
                className="text-sm text-gray-600 hover:text-gray-900 px-4 py-2 rounded hover:bg-gray-100 transition-colors"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={() => setShowConfirm(true)}
              className="text-sm text-white bg-red-600 hover:bg-red-700 px-5 py-2 rounded font-medium transition-colors"
            >
              Start Over
            </button>
          )}
        </div>
      </div>
    </header>
  )
}
