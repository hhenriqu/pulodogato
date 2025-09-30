'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/hooks/useAuth'
import { DashboardSummary } from '@/components/DashboardSummary'
import { AssetAllocationChart } from '@/components/charts/AssetAllocationChart'
import { PerformanceChart } from '@/components/charts/PerformanceChart'
import { PortfolioTable } from '@/components/PortfolioTable'
import { Button } from '@/components/ui/button'
import { Plus, LogOut, Menu } from 'lucide-react'
import type { Portfolio, DashboardSummary as DashboardSummaryType } from '@/types'

export default function DashboardPage() {
  const { user, loading, signOut } = useAuth()
  const router = useRouter()
  const [dashboardData, setDashboardData] = useState<DashboardSummaryType | null>(null)
  const [portfolioData, setPortfolioData] = useState<Portfolio[]>([])
  const [isLoadingData, setIsLoadingData] = useState(true)

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login')
    }
  }, [user, loading, router])

  useEffect(() => {
    if (user) {
      loadDashboardData()
    }
  }, [user])

  const loadDashboardData = async () => {
    try {
      setIsLoadingData(true)
      // TODO: Implementar chamadas para API
      
      // Dados simulados para desenvolvimento
      const mockSummary: DashboardSummaryType = {
        total_invested: 50000,
        current_value: 55000,
        total_profit_loss: 5000,
        total_profit_loss_percentage: 10,
        total_dividends: 1200,
        asset_allocation: {
          stock: 60,
          fii: 25,
          fixed_income: 10,
          international: 5,
        },
      }

      const mockPortfolio: Portfolio[] = [
        {
          asset_id: '1',
          symbol: 'PETR4',
          name: 'Petrobras ON',
          type: 'stock',
          total_quantity: 100,
          average_price: 28.50,
          total_invested: 2850,
          current_price: 32.00,
          current_value: 3200,
          profit_loss: 350,
          profit_loss_percentage: 12.28,
        },
        {
          asset_id: '2',
          symbol: 'ITUB4',
          name: 'Itaú Unibanco ON',
          type: 'stock',
          total_quantity: 200,
          average_price: 25.00,
          total_invested: 5000,
          current_price: 26.50,
          current_value: 5300,
          profit_loss: 300,
          profit_loss_percentage: 6.00,
        },
        {
          asset_id: '3',
          symbol: 'HGLG11',
          name: 'CSHG Logística FII',
          type: 'fii',
          total_quantity: 50,
          average_price: 120.00,
          total_invested: 6000,
          current_price: 125.00,
          current_value: 6250,
          profit_loss: 250,
          profit_loss_percentage: 4.17,
        },
      ]

      setDashboardData(mockSummary)
      setPortfolioData(mockPortfolio)
    } catch (error) {
      console.error('Erro ao carregar dados do dashboard:', error)
    } finally {
      setIsLoadingData(false)
    }
  }

  const handleSignOut = async () => {
    await signOut()
    router.push('/')
  }

  const allocationData = dashboardData ? [
    { name: 'Ações', value: dashboardData.current_value * (dashboardData.asset_allocation.stock / 100), percentage: dashboardData.asset_allocation.stock },
    { name: 'FIIs', value: dashboardData.current_value * (dashboardData.asset_allocation.fii / 100), percentage: dashboardData.asset_allocation.fii },
    { name: 'Renda Fixa', value: dashboardData.current_value * (dashboardData.asset_allocation.fixed_income / 100), percentage: dashboardData.asset_allocation.fixed_income },
    { name: 'Internacional', value: dashboardData.current_value * (dashboardData.asset_allocation.international / 100), percentage: dashboardData.asset_allocation.international },
  ].filter(item => item.value > 0) : []

  const performanceData = [
    { date: '2024-01', portfolio: 45000, benchmark: 44000 },
    { date: '2024-02', portfolio: 47000, benchmark: 45500 },
    { date: '2024-03', portfolio: 49000, benchmark: 47000 },
    { date: '2024-04', portfolio: 52000, benchmark: 49500 },
    { date: '2024-05', portfolio: 55000, benchmark: 51000 },
  ]

  if (loading || isLoadingData) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Carregando dashboard...</p>
        </div>
      </div>
    )
  }

  if (!user || !dashboardData) {
    return null
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
            </div>
            <div className="flex items-center space-x-4">
              <Button
                variant="outline"
                onClick={() => router.push('/dashboard/transactions' as any)}
              >
                <Plus className="h-4 w-4 mr-2" />
                Nova Transação
              </Button>
              <Button variant="ghost" onClick={handleSignOut}>
                <LogOut className="h-4 w-4 mr-2" />
                Sair
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-8">
          {/* Summary Cards */}
          <DashboardSummary
            totalInvested={dashboardData.total_invested}
            currentValue={dashboardData.current_value}
            totalProfitLoss={dashboardData.total_profit_loss}
            totalProfitLossPercentage={dashboardData.total_profit_loss_percentage}
            totalDividends={dashboardData.total_dividends}
          />

          {/* Charts Row */}
          <div className="grid gap-8 md:grid-cols-2">
            <AssetAllocationChart data={allocationData} />
            <PerformanceChart data={performanceData} />
          </div>

          {/* Portfolio Table */}
          <PortfolioTable 
            data={portfolioData}
            onAddTransaction={(assetId) => {
              router.push(`/dashboard/transactions?asset=${assetId}` as any)
            }}
          />
        </div>
      </main>

      {/* Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t md:hidden">
        <div className="grid grid-cols-4 h-16">
          <button className="flex flex-col items-center justify-center text-blue-600">
            <Menu className="h-5 w-5" />
            <span className="text-xs mt-1">Dashboard</span>
          </button>
          <button 
            className="flex flex-col items-center justify-center text-gray-400"
            onClick={() => router.push('/dashboard/investments' as any)}
          >
            <span className="text-xs mt-1">Carteira</span>
          </button>
          <button 
            className="flex flex-col items-center justify-center text-gray-400"
            onClick={() => router.push('/dashboard/transactions' as any)}
          >
            <Plus className="h-5 w-5" />
            <span className="text-xs mt-1">Transação</span>
          </button>
          <button 
            className="flex flex-col items-center justify-center text-gray-400"
            onClick={() => router.push('/dashboard/reports' as any)}
          >
            <span className="text-xs mt-1">Relatórios</span>
          </button>
        </div>
      </nav>
    </div>
  )
}
