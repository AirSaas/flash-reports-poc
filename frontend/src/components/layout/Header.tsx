interface HeaderProps {
  onReset: () => void
}

export function Header({ onReset }: HeaderProps) {
  return (
    <header className="bg-white border-b border-gray-200 px-4 py-3">
      <div className="max-w-6xl mx-auto flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Flash Report POC</h1>
          <p className="text-sm text-gray-600">AirSaas Portfolio Report Generator</p>
        </div>
        <button
          onClick={onReset}
          className="text-sm text-gray-600 hover:text-gray-900 px-3 py-1 rounded-lg hover:bg-gray-100 transition-colors"
        >
          Start Over
        </button>
      </div>
    </header>
  )
}
