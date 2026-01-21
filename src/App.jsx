import { useState, useEffect, useCallback, useMemo } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'

// ============================================================================
// CONFIGURATION & INITIAL DATA
// ============================================================================

const COINGECKO_API = 'https://api.coingecko.com/api/v3'
const COINCAP_API = 'https://api.coincap.io/v2'
const EXCHANGE_RATE_API = 'https://api.exchangerate-api.com/v4/latest/USD'

const REFRESH_INTERVAL = 5 * 60 * 1000 // 5 minutes
const MIN_VALUE_THRESHOLD = 10 // Hide positions < $10

const INITIAL_CONFIG = {
  liquidites: {
    eur: {
      bank: [
        { id: 'livret-a', name: 'Livret A', amount: 1941.42 },
        { id: 'av-millevie', name: 'Millevie Premium 2', amount: 5747.42 }
      ]
    },
    stablecoins: [
      { id: 'usdc-wallet', symbol: 'USDC', coingeckoId: 'usd-coin', amount: 5039.24, location: 'Wallet EVM' },
      { id: 'gho-wallet', symbol: 'GHO', coingeckoId: 'gho', amount: 33.13, location: 'Wallet EVM' },
      { id: 'usdc-cdc', symbol: 'USDC', coingeckoId: 'usd-coin', amount: 113.1, location: 'Crypto.com' },
      { id: 'usdt-bitget', symbol: 'USDT', coingeckoId: 'tether', amount: 245.47, location: 'Bitget' }
    ]
  },
  crypto: [
    { id: 'stkaave-wallet', symbol: 'stkAAVE', coingeckoId: 'aave', amount: 48.71, location: 'Wallet EVM' },
    { id: 'eth-wallet', symbol: 'ETH', coingeckoId: 'ethereum', amount: 0.024, location: 'Wallet EVM' },
    { id: 'btc-cdc', symbol: 'BTC', coingeckoId: 'bitcoin', amount: 0.0328, location: 'Crypto.com' },
    { id: 'cro-cdc', symbol: 'CRO', coingeckoId: 'crypto-com-chain', amount: 3129.05, location: 'Crypto.com' }
  ],
  stocks: {
    etf: [
      { id: 'moat', symbol: 'MOTU.MI', name: 'Wide Moat (VanEck Morningstar)', shares: 40.1, priceEur: 21.89 },
      { id: 'glux', symbol: 'GLUX.PA', name: 'World (Amundi MSCI World LU)', shares: 1.96, priceEur: 215.95 },
      { id: 'iwda', symbol: 'IWDA.AS', name: 'World (iShares Core MSCI World)', shares: 2.91, priceEur: 114.64 },
      { id: 'anx', symbol: 'GLUX.DE', name: 'Global Luxury (Amundi)', shares: 3.25, priceEur: 89.75 },
      { id: 'space', symbol: 'UFO', name: 'Space Innovators (Procure Space)', shares: 3.58, priceEur: 72.32 },
      { id: 'iema', symbol: 'EMIM.AS', name: 'Emerging Markets (iShares Core EM IMI)', shares: 4.83, priceEur: 47.62 },
      { id: 'robo', symbol: 'ROBO.MI', name: 'Robotics and Automatisation (L&G ROBO Global)', shares: 4.81, priceEur: 26 },
      { id: 'qcmp', symbol: 'QUTM.DE', name: 'Quantum Computing (VanEck)', shares: 4.35, priceEur: 23 },
      { id: 'nucl', symbol: 'NUKL.DE', name: 'Uranium and Nuclear (VanEck)', shares: 0.89, priceEur: 56.19 }
    ],
    actions: [
      { id: 'tsla', symbol: 'TSLA', name: 'Tesla Inc', shares: 0.063, priceUsd: 379.28 }
    ]
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

const formatCurrency = (value, currency = 'USD', decimals = 2) => {
  if (value === null || value === undefined || isNaN(value)) return '-'
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  })
  return formatter.format(value)
}

const formatPercent = (value) => {
  if (value === null || value === undefined || isNaN(value)) return '-'
  const sign = value >= 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}%`
}

const formatCompactNumber = (value) => {
  if (Math.abs(value) >= 1000000) return `${(value / 1000000).toFixed(2)}M`
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(2)}K`
  return value.toFixed(2)
}

// ============================================================================
// STORAGE UTILITIES
// ============================================================================

const STORAGE_KEYS = {
  CONFIG: 'stater_config',
  HISTORY: 'stater_history',
  PRICES: 'stater_prices_cache'
}

const loadFromStorage = (key, defaultValue) => {
  try {
    const stored = localStorage.getItem(key)
    return stored ? JSON.parse(stored) : defaultValue
  } catch {
    return defaultValue
  }
}

const saveToStorage = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (e) {
    console.warn('localStorage full, cleaning old data')
    cleanOldHistory()
  }
}

const cleanOldHistory = () => {
  const history = loadFromStorage(STORAGE_KEYS.HISTORY, [])
  const now = Date.now()
  const sevenDays = 7 * 24 * 60 * 60 * 1000
  const thirtyDays = 30 * 24 * 60 * 60 * 1000
  const oneYear = 365 * 24 * 60 * 60 * 1000

  const cleaned = []
  const hourlyBuckets = {}
  const dailyBuckets = {}

  history.forEach(snapshot => {
    const age = now - snapshot.timestamp

    if (age < sevenDays) {
      // Keep all snapshots from last 7 days
      cleaned.push(snapshot)
    } else if (age < thirtyDays) {
      // Aggregate to hourly for 7-30 days
      const hourKey = Math.floor(snapshot.timestamp / (60 * 60 * 1000))
      if (!hourlyBuckets[hourKey]) {
        hourlyBuckets[hourKey] = snapshot
      }
    } else if (age < oneYear) {
      // Aggregate to daily for 30 days - 1 year
      const dayKey = Math.floor(snapshot.timestamp / (24 * 60 * 60 * 1000))
      if (!dailyBuckets[dayKey]) {
        dailyBuckets[dayKey] = snapshot
      }
    }
    // Discard data older than 1 year
  })

  const aggregated = [
    ...cleaned,
    ...Object.values(hourlyBuckets),
    ...Object.values(dailyBuckets)
  ].sort((a, b) => a.timestamp - b.timestamp)

  saveToStorage(STORAGE_KEYS.HISTORY, aggregated)
  return aggregated
}

// ============================================================================
// API FUNCTIONS
// ============================================================================

const fetchCryptoPrices = async (ids) => {
  // Try CoinGecko first (with 24h change)
  try {
    const idsParam = ids.join(',')
    const response = await fetch(
      `${COINGECKO_API}/simple/price?ids=${idsParam}&vs_currencies=usd&include_24hr_change=true`
    )
    if (response.ok) {
      const data = await response.json()
      return { source: 'coingecko', data }
    }
  } catch (e) {
    console.warn('CoinGecko failed, trying CoinCap')
  }

  // Fallback to CoinCap
  try {
    const prices = {}
    const idMapping = {
      'bitcoin': 'bitcoin',
      'ethereum': 'ethereum',
      'aave': 'aave',
      'crypto-com-chain': 'crypto-com-chain',
      'usd-coin': 'usd-coin',
      'tether': 'tether',
      'gho': 'gho'
    }

    for (const id of ids) {
      const coincapId = idMapping[id] || id
      const response = await fetch(`${COINCAP_API}/assets/${coincapId}`)
      if (response.ok) {
        const data = await response.json()
        prices[id] = { usd: parseFloat(data.data.priceUsd) }
      }
    }
    return { source: 'coincap', data: prices }
  } catch (e) {
    console.error('Both APIs failed')
    return { source: 'cache', data: {} }
  }
}

const fetchExchangeRate = async () => {
  try {
    const response = await fetch(EXCHANGE_RATE_API)
    if (response.ok) {
      const data = await response.json()
      return data.rates.EUR
    }
  } catch (e) {
    console.warn('Exchange rate API failed')
  }
  return 0.92 // Fallback rate
}

const fetchStockPrices = async (symbols) => {
  const results = {}

  // Fetch single stock price with fallback proxies
  const fetchSingleStock = async (symbol) => {
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=2d`
    const proxies = [
      `https://api.allorigins.win/get?url=${encodeURIComponent(yahooUrl)}`,
      `https://corsproxy.io/?${encodeURIComponent(yahooUrl)}`
    ]

    for (const proxyUrl of proxies) {
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 8000)

        const response = await fetch(proxyUrl, { signal: controller.signal })
        clearTimeout(timeout)

        if (response.ok) {
          const proxyData = await response.json()
          // AllOrigins wraps in contents, corsproxy returns directly
          const data = proxyData.contents ? JSON.parse(proxyData.contents) : proxyData
          const quote = data.chart?.result?.[0]
          if (quote) {
            const meta = quote.meta
            const currentPrice = meta.regularMarketPrice
            const previousClose = meta.chartPreviousClose || meta.previousClose
            const change24h = previousClose ? ((currentPrice - previousClose) / previousClose) * 100 : 0

            return {
              symbol,
              price: currentPrice,
              change24h,
              currency: meta.currency
            }
          }
        }
      } catch (e) {
        // Try next proxy
      }
    }
    return null
  }

  // Fetch all stocks in parallel
  const promises = symbols.map(symbol => fetchSingleStock(symbol))
  const stockResults = await Promise.all(promises)

  stockResults.forEach(result => {
    if (result) {
      results[result.symbol] = {
        price: result.price,
        change24h: result.change24h,
        currency: result.currency
      }
    }
  })

  return results
}

// ============================================================================
// COMPONENTS
// ============================================================================

const ChevronIcon = ({ isOpen }) => (
  <svg
    className={`w-5 h-5 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
  >
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
  </svg>
)

const ValueDisplay = ({ value, change, changePercent, secondary }) => {
  const isPositive = change >= 0
  const colorClass = change === 0 ? 'text-gray-400' : isPositive ? 'text-gain' : 'text-loss'

  return (
    <div className="text-right">
      <div className="text-white font-medium">{formatCurrency(value)}</div>
      {secondary && <div className="text-gray-500 text-sm">{secondary}</div>}
      {change !== undefined && (
        <div className={`text-sm ${colorClass}`}>
          {formatPercent(changePercent)} ({formatCurrency(change)})
        </div>
      )}
    </div>
  )
}

const AccordionItem = ({ title, value, valueEur, change24h, children, defaultOpen = false, level = 0 }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const paddingClass = level === 0 ? 'pl-0' : level === 1 ? 'pl-4' : 'pl-8'

  if (value !== undefined && value < MIN_VALUE_THRESHOLD) return null

  return (
    <div className={`border-b border-zinc-800 ${paddingClass}`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full py-3 flex items-center justify-between text-left hover:bg-zinc-900/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {children && <ChevronIcon isOpen={isOpen} />}
          <span className={`${level === 0 ? 'font-semibold' : 'font-medium'} ${level > 0 ? 'text-gray-300' : ''}`}>
            {title}
          </span>
        </div>
        {value !== undefined && (
          <div className="flex items-center gap-2">
            {change24h !== undefined && (
              <span className={`text-xs ${change24h >= 0 ? 'text-gain' : 'text-loss'}`}>
                {formatPercent(change24h)}
              </span>
            )}
            <div className="text-right">
              <span className="font-medium">{formatCurrency(value)}</span>
              {valueEur && <span className="text-gray-500 text-sm ml-2">({formatCurrency(valueEur, 'EUR')})</span>}
            </div>
          </div>
        )}
      </button>
      {children && isOpen && (
        <div className="accordion-content pb-2">
          {children}
        </div>
      )}
    </div>
  )
}

const AssetRow = ({ name, symbol, amount, value, location, onEdit, onDelete, change24h, hideAmounts }) => {
  if (value < MIN_VALUE_THRESHOLD) return null

  return (
    <div className="py-2 pl-12 pr-2 flex items-center justify-between hover:bg-zinc-900/50 transition-colors group">
      <div
        onClick={onEdit}
        className="flex-1 cursor-pointer min-w-0"
      >
        <span className="text-gray-300 truncate">{name || symbol}</span>
        {location && <span className="text-gray-600 text-sm ml-2">({location})</span>}
        {amount && !hideAmounts && <span className="text-gray-500 text-sm ml-2">{amount}</span>}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {change24h !== undefined && (
          <span className={`text-xs ${change24h >= 0 ? 'text-gain' : 'text-loss'}`}>
            {formatPercent(change24h)}
          </span>
        )}
        <span className="text-gray-400">{hideAmounts ? '****' : formatCurrency(value)}</span>
        {onDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-500 p-1 transition-opacity"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}

const AddButton = ({ onClick, label }) => (
  <button
    onClick={onClick}
    className="w-full py-2 pl-12 pr-2 flex items-center gap-2 text-gray-500 hover:text-white hover:bg-zinc-900/50 transition-colors"
  >
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
    </svg>
    <span className="text-sm">{label}</span>
  </button>
)

const PeriodSelector = ({ selected, onChange }) => {
  const periods = ['24H', '30D', '1Y', 'Max']

  return (
    <div className="flex gap-1 bg-zinc-900 rounded-lg p-1">
      {periods.map(period => (
        <button
          key={period}
          onClick={() => onChange(period)}
          className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
            selected === period
              ? 'bg-white text-black'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          {period}
        </button>
      ))}
    </div>
  )
}

const PortfolioChart = ({ data, period }) => {
  const formatXAxis = (timestamp) => {
    const date = new Date(timestamp)
    if (period === '24H') return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    if (period === '30D') return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
    return date.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })
  }

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null
    const data = payload[0].payload
    return (
      <div className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2">
        <div className="text-white font-medium">{formatCurrency(data.value)}</div>
        <div className="text-gray-400 text-sm">
          {new Date(data.timestamp).toLocaleString('fr-FR')}
        </div>
      </div>
    )
  }

  const minValue = Math.min(...data.map(d => d.value)) * 0.98
  const maxValue = Math.max(...data.map(d => d.value)) * 1.02
  const isPositive = data.length > 1 && data[data.length - 1].value >= data[0].value

  return (
    <div className="h-48 w-full">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={isPositive ? '#22c55e' : '#ef4444'} stopOpacity={0.3} />
              <stop offset="95%" stopColor={isPositive ? '#22c55e' : '#ef4444'} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="timestamp"
            tickFormatter={formatXAxis}
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#6b7280', fontSize: 12 }}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={[minValue, maxValue]}
            hide
          />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="value"
            stroke={isPositive ? '#22c55e' : '#ef4444'}
            strokeWidth={2}
            fill="url(#colorValue)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

const ALLOCATION_COLORS = ['#6b7280', '#3b82f6', '#8b5cf6']

const AllocationChart = ({ data, hideAmounts }) => {
  const total = data.reduce((sum, d) => sum + d.value, 0)

  return (
    <div className="flex items-center gap-4">
      <div className="w-24 h-24">
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={25}
              outerRadius={40}
              paddingAngle={2}
            >
              {data.map((entry, index) => (
                <Cell key={entry.name} fill={ALLOCATION_COLORS[index % ALLOCATION_COLORS.length]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="flex-1 space-y-1">
        {data.map((item, index) => {
          const percent = total > 0 ? (item.value / total) * 100 : 0
          return (
            <div key={item.name} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: ALLOCATION_COLORS[index % ALLOCATION_COLORS.length] }}
                />
                <span className="text-gray-400">{item.name}</span>
              </div>
              <span className="text-gray-300">
                {hideAmounts ? '***' : `${percent.toFixed(1)}%`}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const EditModal = ({ isOpen, onClose, item, onSave }) => {
  const [value, setValue] = useState('')

  useEffect(() => {
    if (item) {
      setValue(item.amount?.toString() || item.shares?.toString() || item.priceEur?.toString() || item.priceUsd?.toString() || '')
    }
  }, [item])

  if (!isOpen || !item) return null

  const handleSave = () => {
    const numValue = parseFloat(value)
    if (!isNaN(numValue)) {
      onSave(item.id, numValue)
      onClose()
    }
  }

  const fieldName = item.amount !== undefined ? 'amount' : item.shares !== undefined ? 'shares' : item.priceEur !== undefined ? 'priceEur' : 'priceUsd'
  const fieldLabel = fieldName === 'amount' ? 'Montant' : fieldName === 'shares' ? 'Parts' : 'Prix'

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center modal-backdrop bg-black/80" onClick={onClose}>
      <div className="modal-content bg-zinc-900 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-4">{item.name || item.symbol}</h3>

        <div className="mb-4">
          <label className="block text-gray-400 text-sm mb-2">{fieldLabel}</label>
          <input
            type="number"
            step="any"
            value={value}
            onChange={e => setValue(e.target.value)}
            className="w-full text-lg"
            autoFocus
          />
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} className="btn btn-secondary flex-1">Annuler</button>
          <button onClick={handleSave} className="btn btn-primary flex-1">Sauvegarder</button>
        </div>
      </div>
    </div>
  )
}

const AddAssetModal = ({ isOpen, onClose, category, onAdd }) => {
  const [form, setForm] = useState({})

  useEffect(() => {
    if (isOpen) {
      // Reset form based on category
      if (category === 'bank') {
        setForm({ name: '', amount: '' })
      } else if (category === 'stablecoin') {
        setForm({ symbol: '', coingeckoId: '', amount: '', location: '' })
      } else if (category === 'crypto') {
        setForm({ symbol: '', coingeckoId: '', amount: '', location: '' })
      } else if (category === 'etf') {
        setForm({ symbol: '', name: '', shares: '', priceEur: '' })
      } else if (category === 'action') {
        setForm({ symbol: '', name: '', shares: '', priceUsd: '' })
      }
    }
  }, [isOpen, category])

  if (!isOpen) return null

  const handleAdd = () => {
    const id = `${category}-${Date.now()}`
    let newItem = { id, ...form }

    // Convert numeric fields
    if (form.amount) newItem.amount = parseFloat(form.amount)
    if (form.shares) newItem.shares = parseFloat(form.shares)
    if (form.priceEur) newItem.priceEur = parseFloat(form.priceEur)
    if (form.priceUsd) newItem.priceUsd = parseFloat(form.priceUsd)

    onAdd(category, newItem)
    onClose()
  }

  const updateField = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  const titles = {
    bank: 'Ajouter un compte bancaire',
    stablecoin: 'Ajouter un stablecoin',
    crypto: 'Ajouter une crypto',
    etf: 'Ajouter un ETF',
    action: 'Ajouter une action'
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center modal-backdrop bg-black/80" onClick={onClose}>
      <div className="modal-content bg-zinc-900 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-6 max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-4">{titles[category]}</h3>

        <div className="space-y-4">
          {category === 'bank' && (
            <>
              <div>
                <label className="block text-gray-400 text-sm mb-2">Nom</label>
                <input
                  type="text"
                  value={form.name || ''}
                  onChange={e => updateField('name', e.target.value)}
                  placeholder="Livret A, PEL..."
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-2">Montant (EUR)</label>
                <input
                  type="number"
                  step="any"
                  value={form.amount || ''}
                  onChange={e => updateField('amount', e.target.value)}
                  className="w-full"
                />
              </div>
            </>
          )}

          {(category === 'stablecoin' || category === 'crypto') && (
            <>
              <div>
                <label className="block text-gray-400 text-sm mb-2">Symbole</label>
                <input
                  type="text"
                  value={form.symbol || ''}
                  onChange={e => updateField('symbol', e.target.value.toUpperCase())}
                  placeholder="BTC, ETH, USDC..."
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-2">CoinGecko ID</label>
                <input
                  type="text"
                  value={form.coingeckoId || ''}
                  onChange={e => updateField('coingeckoId', e.target.value.toLowerCase())}
                  placeholder="bitcoin, ethereum, usd-coin..."
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-2">Quantite</label>
                <input
                  type="number"
                  step="any"
                  value={form.amount || ''}
                  onChange={e => updateField('amount', e.target.value)}
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-2">Localisation</label>
                <input
                  type="text"
                  value={form.location || ''}
                  onChange={e => updateField('location', e.target.value)}
                  placeholder="Wallet EVM, Binance, Kraken..."
                  className="w-full"
                />
              </div>
            </>
          )}

          {category === 'etf' && (
            <>
              <div>
                <label className="block text-gray-400 text-sm mb-2">Symbole</label>
                <input
                  type="text"
                  value={form.symbol || ''}
                  onChange={e => updateField('symbol', e.target.value.toUpperCase())}
                  placeholder="IWDA.AS, VWCE.DE..."
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-2">Nom</label>
                <input
                  type="text"
                  value={form.name || ''}
                  onChange={e => updateField('name', e.target.value)}
                  placeholder="Theme (Nom du fonds)"
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-2">Parts</label>
                <input
                  type="number"
                  step="any"
                  value={form.shares || ''}
                  onChange={e => updateField('shares', e.target.value)}
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-2">Prix (EUR)</label>
                <input
                  type="number"
                  step="any"
                  value={form.priceEur || ''}
                  onChange={e => updateField('priceEur', e.target.value)}
                  className="w-full"
                />
              </div>
            </>
          )}

          {category === 'action' && (
            <>
              <div>
                <label className="block text-gray-400 text-sm mb-2">Symbole</label>
                <input
                  type="text"
                  value={form.symbol || ''}
                  onChange={e => updateField('symbol', e.target.value.toUpperCase())}
                  placeholder="AAPL, MSFT..."
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-2">Nom</label>
                <input
                  type="text"
                  value={form.name || ''}
                  onChange={e => updateField('name', e.target.value)}
                  placeholder="Apple Inc, Microsoft..."
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-2">Parts</label>
                <input
                  type="number"
                  step="any"
                  value={form.shares || ''}
                  onChange={e => updateField('shares', e.target.value)}
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-2">Prix (USD)</label>
                <input
                  type="number"
                  step="any"
                  value={form.priceUsd || ''}
                  onChange={e => updateField('priceUsd', e.target.value)}
                  className="w-full"
                />
              </div>
            </>
          )}
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="btn btn-secondary flex-1">Annuler</button>
          <button onClick={handleAdd} className="btn btn-primary flex-1">Ajouter</button>
        </div>
      </div>
    </div>
  )
}

const ImportExportModal = ({ isOpen, onClose, config, onImport, onReset }) => {
  const [jsonText, setJsonText] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (isOpen) {
      setJsonText(JSON.stringify(config, null, 2))
      setError('')
    }
  }, [isOpen, config])

  if (!isOpen) return null

  const handleImport = () => {
    try {
      const parsed = JSON.parse(jsonText)
      onImport(parsed)
      onClose()
    } catch (e) {
      setError('JSON invalide')
    }
  }

  const handleExport = () => {
    const blob = new Blob([jsonText], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'stater-config.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center modal-backdrop bg-black/80" onClick={onClose}>
      <div className="modal-content bg-zinc-900 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-zinc-800">
          <h3 className="text-lg font-semibold">Import / Export Configuration</h3>
        </div>

        <div className="flex-1 overflow-auto p-4">
          <textarea
            value={jsonText}
            onChange={e => { setJsonText(e.target.value); setError('') }}
            className="w-full h-64 font-mono text-sm resize-none"
          />
          {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
        </div>

        <div className="p-4 border-t border-zinc-800 flex flex-col gap-3">
          <div className="flex gap-3">
            <button onClick={onClose} className="btn btn-secondary flex-1">Fermer</button>
            <button onClick={handleExport} className="btn btn-secondary flex-1">Exporter</button>
            <button onClick={handleImport} className="btn btn-primary flex-1">Importer</button>
          </div>
          <button
            onClick={() => {
              if (confirm('Remettre la configuration par defaut ? Les donnees actuelles seront perdues.')) {
                onReset()
                onClose()
              }
            }}
            className="btn bg-red-900/50 text-red-400 hover:bg-red-900 w-full"
          >
            Reset configuration
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// MAIN APP
// ============================================================================

export default function App() {
  const [config, setConfig] = useState(() => loadFromStorage(STORAGE_KEYS.CONFIG, INITIAL_CONFIG))
  const [prices, setPrices] = useState(() => loadFromStorage(STORAGE_KEYS.PRICES, {}))
  const [eurRate, setEurRate] = useState(0.92)
  const [history, setHistory] = useState(() => loadFromStorage(STORAGE_KEYS.HISTORY, []))
  const [period, setPeriod] = useState('30D')
  const [loading, setLoading] = useState(true)
  const [editingItem, setEditingItem] = useState(null)
  const [showImportExport, setShowImportExport] = useState(false)
  const [lastUpdate, setLastUpdate] = useState(null)
  const [addingCategory, setAddingCategory] = useState(null)
  const [hideAmounts, setHideAmounts] = useState(() => loadFromStorage('stater_hide_amounts', false))
  const [priceChanges, setPriceChanges] = useState({})
  const [stockPrices, setStockPrices] = useState({})

  // Get all crypto IDs for price fetching
  const cryptoIds = useMemo(() => {
    const ids = new Set()
    config.crypto.forEach(c => ids.add(c.coingeckoId))
    config.liquidites.stablecoins.forEach(s => ids.add(s.coingeckoId))
    return Array.from(ids)
  }, [config])

  // Get all stock symbols for price fetching
  const stockSymbols = useMemo(() => {
    const symbols = []
    config.stocks.etf.forEach(e => symbols.push(e.symbol))
    config.stocks.actions.forEach(a => symbols.push(a.symbol))
    return symbols
  }, [config])

  // Fetch prices
  const fetchPrices = useCallback(async () => {
    setLoading(true)
    try {
      const [cryptoResult, rate, stockResult] = await Promise.all([
        fetchCryptoPrices(cryptoIds),
        fetchExchangeRate(),
        fetchStockPrices(stockSymbols)
      ])

      const newPrices = { ...prices }
      const newChanges = { ...priceChanges }
      Object.entries(cryptoResult.data).forEach(([id, data]) => {
        newPrices[id] = data.usd
        if (data.usd_24h_change !== undefined) {
          newChanges[id] = data.usd_24h_change
        }
      })

      setPrices(newPrices)
      setPriceChanges(newChanges)
      setStockPrices(stockResult)
      setEurRate(rate)
      saveToStorage(STORAGE_KEYS.PRICES, newPrices)
      setLastUpdate(new Date())
    } catch (e) {
      console.error('Failed to fetch prices', e)
    } finally {
      setLoading(false)
    }
  }, [cryptoIds, stockSymbols, prices])

  // Calculate values
  const calculations = useMemo(() => {
    // Liquidites EUR (bank accounts)
    const bankTotal = config.liquidites.eur.bank.reduce((sum, b) => sum + b.amount, 0)
    const bankTotalUsd = bankTotal / eurRate

    // Stablecoins (with weighted 24h change)
    const stablecoinsBySymbol = {}
    let stablecoinsWeightedChange = 0
    let stablecoinsTotalForChange = 0
    config.liquidites.stablecoins.forEach(s => {
      const price = prices[s.coingeckoId] || 1
      const value = s.amount * price
      const change = priceChanges[s.coingeckoId]
      if (change !== undefined) {
        stablecoinsWeightedChange += value * change
        stablecoinsTotalForChange += value
      }
      if (!stablecoinsBySymbol[s.symbol]) {
        stablecoinsBySymbol[s.symbol] = { items: [], total: 0 }
      }
      stablecoinsBySymbol[s.symbol].items.push({ ...s, value })
      stablecoinsBySymbol[s.symbol].total += value
    })
    const stablecoinsTotal = Object.values(stablecoinsBySymbol).reduce((sum, s) => sum + s.total, 0)
    const stablecoinsChange24h = stablecoinsTotalForChange > 0 ? stablecoinsWeightedChange / stablecoinsTotalForChange : 0

    // Crypto (with weighted 24h change)
    const cryptoBySymbol = {}
    let cryptoWeightedChange = 0
    let cryptoTotalForChange = 0
    config.crypto.forEach(c => {
      const price = prices[c.coingeckoId] || 0
      const value = c.amount * price
      const change = priceChanges[c.coingeckoId]
      if (change !== undefined && value > 0) {
        cryptoWeightedChange += value * change
        cryptoTotalForChange += value
      }
      if (!cryptoBySymbol[c.symbol]) {
        cryptoBySymbol[c.symbol] = { items: [], total: 0, price }
      }
      cryptoBySymbol[c.symbol].items.push({ ...c, value, price })
      cryptoBySymbol[c.symbol].total += value
    })
    const cryptoTotal = Object.values(cryptoBySymbol).reduce((sum, c) => sum + c.total, 0)
    const cryptoChange24h = cryptoTotalForChange > 0 ? cryptoWeightedChange / cryptoTotalForChange : undefined

    // ETF (use API prices if available, with weighted 24h change)
    let etfWeightedChange = 0
    let etfTotalForChange = 0
    const etfTotal = config.stocks.etf.reduce((sum, e) => {
      const stockData = stockPrices[e.symbol]
      const price = stockData?.price || e.priceEur
      const isEur = !stockData || stockData.currency === 'EUR'
      const value = isEur ? e.shares * price / eurRate : e.shares * price
      if (stockData?.change24h !== undefined) {
        etfWeightedChange += value * stockData.change24h
        etfTotalForChange += value
      }
      return sum + value
    }, 0)
    const etfChange24h = etfTotalForChange > 0 ? etfWeightedChange / etfTotalForChange : undefined

    // Actions (use API prices if available, with weighted 24h change)
    let actionsWeightedChange = 0
    let actionsTotalForChange = 0
    const actionsTotal = config.stocks.actions.reduce((sum, a) => {
      const stockData = stockPrices[a.symbol]
      const price = stockData?.price || a.priceUsd || a.priceEur
      const isUsd = stockData?.currency === 'USD' || a.priceUsd
      const value = isUsd ? a.shares * price : a.shares * price / eurRate
      if (stockData?.change24h !== undefined) {
        actionsWeightedChange += value * stockData.change24h
        actionsTotalForChange += value
      }
      return sum + value
    }, 0)
    const actionsChange24h = actionsTotalForChange > 0 ? actionsWeightedChange / actionsTotalForChange : undefined

    const liquiditesTotal = bankTotalUsd + stablecoinsTotal
    const liquiditesChange24h = stablecoinsTotalForChange > 0 ? (stablecoinsWeightedChange / (liquiditesTotal || 1)) : 0

    const stocksTotal = etfTotal + actionsTotal
    const stocksTotalForChange = etfTotalForChange + actionsTotalForChange
    const stocksChange24h = stocksTotalForChange > 0 ? (etfWeightedChange + actionsWeightedChange) / stocksTotalForChange : undefined

    const grandTotal = liquiditesTotal + cryptoTotal + stocksTotal

    // Calculate overall portfolio 24h change (weighted average)
    const totalWeightedChange = stablecoinsWeightedChange + cryptoWeightedChange + etfWeightedChange + actionsWeightedChange
    const totalForChange = stablecoinsTotalForChange + cryptoTotalForChange + etfTotalForChange + actionsTotalForChange
    const portfolioChange24h = totalForChange > 0 ? totalWeightedChange / totalForChange : undefined

    // Sort bank items by value (descending)
    const sortedBankItems = [...config.liquidites.eur.bank].sort((a, b) => b.amount - a.amount)

    // Sort ETF by value (descending)
    const sortedEtfItems = [...config.stocks.etf].sort((a, b) => {
      const dataA = stockPrices[a.symbol]
      const dataB = stockPrices[b.symbol]
      const priceA = dataA?.price || a.priceEur
      const priceB = dataB?.price || b.priceEur
      return (b.shares * priceB) - (a.shares * priceA)
    })

    // Sort actions by value (descending)
    const sortedActionsItems = [...config.stocks.actions].sort((a, b) => {
      const dataA = stockPrices[a.symbol]
      const dataB = stockPrices[b.symbol]
      const priceA = dataA?.price || a.priceUsd || a.priceEur
      const priceB = dataB?.price || b.priceUsd || b.priceEur
      return (b.shares * priceB) - (a.shares * priceA)
    })

    // Sort crypto by total value (descending)
    const sortedCryptoBySymbol = Object.fromEntries(
      Object.entries(cryptoBySymbol).sort(([,a], [,b]) => b.total - a.total)
    )

    // Sort stablecoins by total value (descending)
    const sortedStablecoinsBySymbol = Object.fromEntries(
      Object.entries(stablecoinsBySymbol).sort(([,a], [,b]) => b.total - a.total)
    )

    // Allocation data for pie chart
    const allocation = [
      { name: 'Liquidites', value: liquiditesTotal },
      { name: 'Crypto', value: cryptoTotal },
      { name: 'Actions/ETF', value: stocksTotal }
    ].filter(a => a.value > 0)

    return {
      grandTotal,
      grandTotalEur: grandTotal * eurRate,
      change24h: portfolioChange24h,
      liquidites: {
        total: liquiditesTotal,
        change24h: liquiditesChange24h,
        eur: { total: bankTotalUsd, totalEur: bankTotal, items: sortedBankItems },
        stablecoins: { total: stablecoinsTotal, change24h: stablecoinsChange24h, bySymbol: sortedStablecoinsBySymbol }
      },
      crypto: {
        total: cryptoTotal,
        change24h: cryptoChange24h,
        bySymbol: sortedCryptoBySymbol
      },
      stocks: {
        total: stocksTotal,
        change24h: stocksChange24h,
        etf: { total: etfTotal, change24h: etfChange24h, items: sortedEtfItems },
        actions: { total: actionsTotal, change24h: actionsChange24h, items: sortedActionsItems }
      },
      allocation,
      eurRate
    }
  }, [config, prices, eurRate, stockPrices, priceChanges])

  // Save snapshot to history
  const saveSnapshot = useCallback(() => {
    const snapshot = {
      timestamp: Date.now(),
      value: calculations.grandTotal,
      details: {
        liquidites: calculations.liquidites.total,
        crypto: calculations.crypto.total,
        stocks: calculations.stocks.total
      }
    }

    const newHistory = [...history, snapshot]
    setHistory(newHistory)
    saveToStorage(STORAGE_KEYS.HISTORY, newHistory)

    // Periodically clean old data
    if (newHistory.length % 100 === 0) {
      cleanOldHistory()
    }
  }, [calculations, history])

  // Filter history for chart
  const chartData = useMemo(() => {
    const now = Date.now()
    let cutoff
    switch (period) {
      case '24H': cutoff = now - 24 * 60 * 60 * 1000; break
      case '30D': cutoff = now - 30 * 24 * 60 * 60 * 1000; break
      case '1Y': cutoff = now - 365 * 24 * 60 * 60 * 1000; break
      default: cutoff = 0
    }

    return history.filter(h => h.timestamp >= cutoff)
  }, [history, period])

  // Calculate change for period
  const periodChange = useMemo(() => {
    if (chartData.length < 2) return { value: 0, percent: 0 }
    const first = chartData[0].value
    const last = chartData[chartData.length - 1].value
    return {
      value: last - first,
      percent: ((last - first) / first) * 100
    }
  }, [chartData])

  // Initial fetch and refresh interval
  useEffect(() => {
    fetchPrices()
    const interval = setInterval(() => {
      fetchPrices()
    }, REFRESH_INTERVAL)
    return () => clearInterval(interval)
  }, [])

  // Save snapshot when prices update
  useEffect(() => {
    if (!loading && calculations.grandTotal > 0) {
      saveSnapshot()
    }
  }, [prices])

  // Save config changes
  useEffect(() => {
    saveToStorage(STORAGE_KEYS.CONFIG, config)
  }, [config])

  // Handle edit save
  const handleEditSave = (itemId, newValue) => {
    setConfig(prev => {
      const newConfig = JSON.parse(JSON.stringify(prev))

      // Find and update the item
      const findAndUpdate = (items, key = 'amount') => {
        const item = items.find(i => i.id === itemId)
        if (item) {
          item[key] = newValue
          return true
        }
        return false
      }

      if (findAndUpdate(newConfig.liquidites.eur.bank)) return newConfig
      if (findAndUpdate(newConfig.liquidites.stablecoins)) return newConfig
      if (findAndUpdate(newConfig.crypto)) return newConfig
      if (findAndUpdate(newConfig.stocks.etf, 'shares')) return newConfig
      if (findAndUpdate(newConfig.stocks.actions, 'shares')) return newConfig

      return newConfig
    })
  }

  // Handle import
  const handleImport = (newConfig) => {
    setConfig(newConfig)
    fetchPrices()
  }

  // Handle reset to default config
  const handleReset = () => {
    setConfig(INITIAL_CONFIG)
    setHistory([])
    localStorage.removeItem(STORAGE_KEYS.HISTORY)
    fetchPrices()
  }

  // Handle add asset
  const handleAddAsset = (category, newItem) => {
    setConfig(prev => {
      const newConfig = JSON.parse(JSON.stringify(prev))

      switch (category) {
        case 'bank':
          newConfig.liquidites.eur.bank.push(newItem)
          break
        case 'stablecoin':
          newConfig.liquidites.stablecoins.push(newItem)
          break
        case 'crypto':
          newConfig.crypto.push(newItem)
          break
        case 'etf':
          newConfig.stocks.etf.push(newItem)
          break
        case 'action':
          newConfig.stocks.actions.push(newItem)
          break
      }

      return newConfig
    })
    fetchPrices()
  }

  // Handle delete asset
  const handleDeleteAsset = (itemId) => {
    if (!confirm('Supprimer cet actif ?')) return

    setConfig(prev => {
      const newConfig = JSON.parse(JSON.stringify(prev))

      newConfig.liquidites.eur.bank = newConfig.liquidites.eur.bank.filter(i => i.id !== itemId)
      newConfig.liquidites.stablecoins = newConfig.liquidites.stablecoins.filter(i => i.id !== itemId)
      newConfig.crypto = newConfig.crypto.filter(i => i.id !== itemId)
      newConfig.stocks.etf = newConfig.stocks.etf.filter(i => i.id !== itemId)
      newConfig.stocks.actions = newConfig.stocks.actions.filter(i => i.id !== itemId)

      return newConfig
    })
  }

  return (
    <div className="min-h-screen bg-black pb-safe">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-black/95 backdrop-blur border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">Stater</h1>
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                setHideAmounts(!hideAmounts)
                saveToStorage('stater_hide_amounts', !hideAmounts)
              }}
              className="text-gray-400 hover:text-white p-2"
              title={hideAmounts ? 'Afficher les montants' : 'Masquer les montants'}
            >
              {hideAmounts ? (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              )}
            </button>
            <button
              onClick={() => setShowImportExport(true)}
              className="text-gray-400 hover:text-white p-2"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="px-4 py-4">
        {/* Total Value Display */}
        <section className="mb-6">
          <div className="text-center mb-4">
            <div className="text-4xl font-bold mb-1">
              {loading && !calculations.grandTotal ? (
                <span className="text-gray-500">Chargement...</span>
              ) : hideAmounts ? (
                '******'
              ) : (
                formatCurrency(calculations.grandTotal)
              )}
            </div>
            <div className="text-gray-500 text-lg">
              {hideAmounts ? '****' : formatCurrency(calculations.grandTotalEur, 'EUR')}
            </div>
            {!hideAmounts && (
              <div className={`text-sm mt-1 ${periodChange.value >= 0 ? 'text-gain' : 'text-loss'}`}>
                {formatPercent(periodChange.percent)} ({formatCurrency(periodChange.value)})
              </div>
            )}
            {lastUpdate && (
              <div className="text-gray-600 text-xs mt-2">
                Mis a jour: {lastUpdate.toLocaleTimeString('fr-FR')}
              </div>
            )}
          </div>

          {/* Allocation Chart */}
          {calculations.allocation && calculations.allocation.length > 0 && (
            <div className="mb-4 p-4 bg-zinc-900/50 rounded-xl">
              <AllocationChart data={calculations.allocation} hideAmounts={hideAmounts} />
            </div>
          )}

          {/* Period Selector */}
          <div className="flex justify-center mb-4">
            <PeriodSelector selected={period} onChange={setPeriod} />
          </div>

          {/* Chart */}
          {chartData.length > 0 && !hideAmounts ? (
            <PortfolioChart data={chartData} period={period} />
          ) : hideAmounts ? (
            <div className="h-48 flex items-center justify-center text-gray-500">
              Graphique masque
            </div>
          ) : (
            <div className="h-48 flex items-center justify-center text-gray-500">
              Pas encore de donnees historiques
            </div>
          )}
        </section>

        {/* Accordion Structure */}
        <section className="border-t border-zinc-800">
          {/* Liquidites */}
          <AccordionItem
            title="Liquidites"
            value={hideAmounts ? null : calculations.liquidites.total}
            valueEur={hideAmounts ? null : calculations.liquidites.total * eurRate}
            change24h={hideAmounts ? null : calculations.liquidites.change24h}
            level={0}
          >
            {/* EUR Bank Accounts */}
            <AccordionItem
              title="EUR"
              value={hideAmounts ? null : calculations.liquidites.eur.total}
              valueEur={hideAmounts ? null : calculations.liquidites.eur.totalEur}
              level={1}
            >
              {calculations.liquidites.eur.items.map(item => (
                <AssetRow
                  key={item.id}
                  name={item.name}
                  value={item.amount / eurRate}
                  onEdit={() => setEditingItem(item)}
                  onDelete={() => handleDeleteAsset(item.id)}
                  hideAmounts={hideAmounts}
                />
              ))}
              <AddButton onClick={() => setAddingCategory('bank')} label="Ajouter un compte" />
            </AccordionItem>

            {/* Stablecoins */}
            <AccordionItem
              title="Stablecoins"
              value={hideAmounts ? null : calculations.liquidites.stablecoins.total}
              change24h={hideAmounts ? null : calculations.liquidites.stablecoins.change24h}
              level={1}
            >
              {Object.entries(calculations.liquidites.stablecoins.bySymbol).map(([symbol, data]) => (
                <AccordionItem key={symbol} title={symbol} value={hideAmounts ? null : data.total} level={2}>
                  {data.items.map(item => (
                    <AssetRow
                      key={item.id}
                      name={item.location}
                      amount={item.amount.toFixed(2)}
                      value={item.value}
                      onEdit={() => setEditingItem(item)}
                      onDelete={() => handleDeleteAsset(item.id)}
                      change24h={priceChanges[item.coingeckoId]}
                      hideAmounts={hideAmounts}
                    />
                  ))}
                </AccordionItem>
              ))}
              <AddButton onClick={() => setAddingCategory('stablecoin')} label="Ajouter un stablecoin" />
            </AccordionItem>
          </AccordionItem>

          {/* Crypto */}
          <AccordionItem
            title="Crypto"
            value={hideAmounts ? null : calculations.crypto.total}
            change24h={hideAmounts ? null : calculations.crypto.change24h}
            level={0}
          >
            {Object.entries(calculations.crypto.bySymbol).map(([symbol, data]) => (
              <AccordionItem key={symbol} title={symbol} value={hideAmounts ? null : data.total} change24h={priceChanges[data.items[0]?.coingeckoId]} level={1}>
                {data.items.map(item => (
                  <AssetRow
                    key={item.id}
                    name={item.location}
                    amount={`${item.amount} @ ${formatCurrency(item.price)}`}
                    value={item.value}
                    onEdit={() => setEditingItem(item)}
                    onDelete={() => handleDeleteAsset(item.id)}
                    change24h={priceChanges[item.coingeckoId]}
                    hideAmounts={hideAmounts}
                  />
                ))}
              </AccordionItem>
            ))}
            <AddButton onClick={() => setAddingCategory('crypto')} label="Ajouter une crypto" />
          </AccordionItem>

          {/* Actions/ETF */}
          <AccordionItem
            title="Actions/ETF"
            value={hideAmounts ? null : calculations.stocks.total}
            change24h={hideAmounts ? null : calculations.stocks.change24h}
            level={0}
          >
            {/* ETF */}
            <AccordionItem
              title="ETF"
              value={hideAmounts ? null : calculations.stocks.etf.total}
              change24h={hideAmounts ? null : calculations.stocks.etf.change24h}
              level={1}
            >
              {calculations.stocks.etf.items.map(item => {
                const stockData = stockPrices[item.symbol]
                const price = stockData?.price || item.priceEur
                const isEur = !stockData || stockData.currency === 'EUR'
                const value = isEur ? item.shares * price / eurRate : item.shares * price
                if (value < MIN_VALUE_THRESHOLD) return null
                return (
                  <AssetRow
                    key={item.id}
                    name={item.name}
                    amount={`${item.shares} @ ${formatCurrency(price, isEur ? 'EUR' : 'USD')}`}
                    value={value}
                    onEdit={() => setEditingItem(item)}
                    onDelete={() => handleDeleteAsset(item.id)}
                    hideAmounts={hideAmounts}
                    change24h={stockData?.change24h}
                  />
                )
              })}
              <AddButton onClick={() => setAddingCategory('etf')} label="Ajouter un ETF" />
            </AccordionItem>

            {/* Actions */}
            <AccordionItem
              title="Actions"
              value={hideAmounts ? null : calculations.stocks.actions.total}
              change24h={hideAmounts ? null : calculations.stocks.actions.change24h}
              level={1}
            >
              {calculations.stocks.actions.items.map(item => {
                const stockData = stockPrices[item.symbol]
                const price = stockData?.price || item.priceUsd || item.priceEur
                const isUsd = stockData?.currency === 'USD' || item.priceUsd
                const value = isUsd ? item.shares * price : item.shares * price / eurRate
                if (value < MIN_VALUE_THRESHOLD) return null
                return (
                  <AssetRow
                    key={item.id}
                    name={item.name || item.symbol}
                    amount={`${item.shares} @ ${formatCurrency(price, isUsd ? 'USD' : 'EUR')}`}
                    value={value}
                    onEdit={() => setEditingItem(item)}
                    onDelete={() => handleDeleteAsset(item.id)}
                    hideAmounts={hideAmounts}
                    change24h={stockData?.change24h}
                  />
                )
              })}
              <AddButton onClick={() => setAddingCategory('action')} label="Ajouter une action" />
            </AccordionItem>
          </AccordionItem>
        </section>
      </main>

      {/* Modals */}
      <EditModal
        isOpen={!!editingItem}
        onClose={() => setEditingItem(null)}
        item={editingItem}
        onSave={handleEditSave}
      />

      <AddAssetModal
        isOpen={!!addingCategory}
        onClose={() => setAddingCategory(null)}
        category={addingCategory}
        onAdd={handleAddAsset}
      />

      <ImportExportModal
        isOpen={showImportExport}
        onClose={() => setShowImportExport(false)}
        config={config}
        onImport={handleImport}
        onReset={handleReset}
      />
    </div>
  )
}
