import { lazy } from 'react'
import {
  LayoutDashboard, Calendar, ShoppingCart, Package,
  PawPrint, MessageSquare, Users, Settings, TrendingUp,
  FileText, CreditCard, Shield, Trophy, Megaphone,
  Wallet, ClipboardList, Webhook,
} from 'lucide-react'
import { DashboardServiceKpiEnhancer } from '../modules/petshop/components/DashboardServiceKpiEnhancer'
import { ClientHistoryGroomingEnhancer } from '../modules/petshop/components/ClientHistoryGroomingEnhancer'

const DashboardPage = lazy(() => import('../modules/petshop/pages/DashboardPage'))
const AgendaPage = lazy(() => import('../modules/petshop/pages/AgendaPackageIntegratedPage'))
const VendasPage = lazy(() => import('../modules/petshop/pages/VendasPage'))
const EstoquePage = lazy(() => import('../modules/petshop/pages/EstoquePage'))
const PetsPage = lazy(() => import('../modules/petshop/pages/PetsPage'))
const ChatPage = lazy(() => import('../modules/petshop/pages/ChatPage'))
const PlanosPage = lazy(() => import('../modules/petshop/pages/PlanosResponsivePage'))
const ServicosPage = lazy(() => import('../modules/petshop/pages/ServicosPage'))
const FidelidadePage = lazy(() => import('../modules/petshop/pages/FidelidadePage'))
const EquipePage = lazy(() => import('../modules/petshop/pages/EquipePage'))
const CampanhasPage = lazy(() => import('../modules/petshop/pages/CampanhasPage'))
const CaixaPage = lazy(() => import('../modules/petshop/pages/CaixaPage'))
const OrdensEntregaPage = lazy(() => import('../modules/petshop/pages/OrdensBanhoTosaIntegratedPage'))
const GrowthPage = lazy(() => import('../modules/petshop/pages/GrowthPage'))
const PetshopReportsPage = lazy(() => import('../modules/petshop/pages/PetshopReportsPage'))
const UsersPage = lazy(() => import('../shared/pages/UsersPage'))
const SettingsPage = lazy(() => import('../shared/pages/SettingsIntegratedPage'))
const MetaWhatsappPage = lazy(() => import('../shared/pages/MetaWhatsappPage'))
const BillingPage = lazy(() => import('../shared/pages/BillingPage'))
const LogsPage = lazy(() => import('../shared/pages/LogsPage'))
const SupportHubPage = lazy(() => import('../shared/pages/SupportHubPage'))

function DashboardWithServiceKpis(props) {
  return (
    <>
      <DashboardPage {...props} />
      <DashboardServiceKpiEnhancer />
    </>
  )
}

function AgendaWithClientHistory(props) {
  return (
    <>
      <AgendaPage {...props} />
      <DashboardServiceKpiEnhancer />
      <ClientHistoryGroomingEnhancer />
    </>
  )
}

function PetsWithClientHistory(props) {
  return (
    <>
      <PetsPage {...props} />
      <ClientHistoryGroomingEnhancer />
    </>
  )
}

export const MODULES = {
  petshop: {
    id: 'petshop',
    name: 'PetShop CRM',
    shortName: 'PetShop',
    icon: PawPrint,
    theme: {
      primaryBg: 'bg-[var(--primary)]',
      text: 'text-[var(--primary)]',
      textPrimary: 'text-[var(--primary)]',
      bgLight: 'bg-[var(--primary-bg-light)]',
      border: 'border-[var(--primary-border)]',
      shadow: 'shadow-none',
    },
    roles: [
      { id: 'admin_pet', label: 'Admin Pet', description: 'Acesso total ao modulo PetShop' },
      { id: 'funcionario_pet', label: 'Funcionario Pet', description: 'Acesso a Agenda, PDV e Clientes' },
    ],
    nav: [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['admin_pet', 'funcionario_pet'] },
      { id: 'agenda', label: 'Agenda', icon: Calendar, roles: ['admin_pet', 'funcionario_pet'] },
      { id: 'vendas', label: 'Vendas / PDV', icon: ShoppingCart, roles: ['admin_pet', 'funcionario_pet'] },
      { id: 'estoque', label: 'Estoque', icon: Package, roles: ['admin_pet'] },
      { id: 'pets', label: 'Clientes & Pets', icon: PawPrint, roles: ['admin_pet', 'funcionario_pet'] },
      { id: 'chat', label: 'Chat IA', icon: MessageSquare, roles: ['admin_pet'] },
    ],
    legacyAdminNav: [
      { id: 'usuarios', label: 'Usuarios', icon: Users, roles: ['admin_pet'] },
      { id: 'relatorios', label: 'Relatorios', icon: TrendingUp, roles: ['admin_pet'] },
      { id: 'financeiro', label: 'Financeiro / Notas', icon: CreditCard, roles: ['admin_pet'] },
      { id: 'config', label: 'Configuracoes', icon: Settings, roles: ['admin_pet'] },
      { id: 'logs', label: 'Logs', icon: FileText, roles: ['admin_pet'] },
    ],
    navSections: [
      {
        title: 'Menu Principal',
        items: [
          { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['admin_pet', 'funcionario_pet'] },
          { id: 'agenda', label: 'Agenda', icon: Calendar, roles: ['admin_pet', 'funcionario_pet'] },
          { id: 'vendas', label: 'Vendas / PDV', icon: ShoppingCart, roles: ['admin_pet', 'funcionario_pet'] },
          { id: 'ordens', label: 'Ordens / Entrega', icon: ClipboardList, roles: ['admin_pet', 'funcionario_pet'] },
          { id: 'chat', label: 'Atendimento WhatsApp', icon: MessageSquare, roles: ['admin_pet', 'funcionario_pet'] },
          { id: 'growth', label: 'Crescimento CRM', icon: TrendingUp, roles: ['admin_pet'] },
        ],
      },
      {
        title: 'Clientes',
        items: [
          { id: 'pets', label: 'Clientes & Pets', icon: PawPrint, roles: ['admin_pet', 'funcionario_pet'] },
          { id: 'fidelidade', label: 'Fidelidade', icon: Trophy, roles: ['admin_pet', 'funcionario_pet'] },
        ],
      },
      {
        title: 'Financeiro',
        items: [
          { id: 'caixa', label: 'Controle de Caixa', icon: Wallet, roles: ['admin_pet', 'funcionario_pet'] },
          { id: 'relatorios', label: 'Relatorios', icon: TrendingUp, roles: ['admin_pet'] },
          { id: 'planos', label: 'Planos', icon: CreditCard, roles: ['admin_pet'] },
          { id: 'financeiro', label: 'Financeiro / Notas', icon: CreditCard, roles: ['admin_pet'] },
        ],
      },
      {
        title: 'Estoque',
        items: [
          { id: 'estoque', label: 'Estoque', icon: Package, roles: ['admin_pet'] },
          { id: 'servicos', label: 'Serviços', icon: ClipboardList, roles: ['admin_pet'] },
        ],
      },
      {
        title: 'Campanhas',
        items: [
          { id: 'campanhas', label: 'Campanhas', icon: Megaphone, roles: ['admin_pet'] },
        ],
      },
      {
        title: 'Administracao',
        items: [
          { id: 'usuarios', label: 'Usuarios & Cargos', icon: Users, roles: ['admin_pet'] },
          { id: 'equipe', label: 'Equipe & Comissoes', icon: Users, roles: ['admin_pet'] },
          { id: 'meta-whatsapp', label: 'Meta / WhatsApp', icon: Webhook, roles: ['admin_pet'] },
          { id: 'config', label: 'Configuracoes', icon: Settings, roles: ['admin_pet'] },
          { id: 'logs', label: 'Logs', icon: FileText, roles: ['admin_pet'] },
        ],
      },
    ],
    adminNav: [],
    pages: {
      dashboard: DashboardWithServiceKpis,
      agenda: AgendaWithClientHistory,
      vendas: VendasPage,
      ordens: OrdensEntregaPage,
      growth: GrowthPage,
      estoque: EstoquePage,
      servicos: ServicosPage,
      pets: PetsWithClientHistory,
      fidelidade: FidelidadePage,
      chat: ChatPage,
      caixa: CaixaPage,
      planos: PlanosPage,
      campanhas: CampanhasPage,
      usuarios: UsersPage,
      equipe: EquipePage,
      relatorios: PetshopReportsPage,
      financeiro: BillingPage,
      'meta-whatsapp': MetaWhatsappPage,
      config: SettingsPage,
      logs: LogsPage,
    },
  },

  system: {
    id: 'system',
    name: 'Gestao Central',
    shortName: 'Hub Central',
    icon: Shield,
    theme: {
      primaryBg: 'bg-[#8B5CF6]',
      text: 'text-[#8B5CF6]',
      textPrimary: 'text-[#8B5CF6]',
      bgLight: 'bg-[#8B5CF6]/12',
      border: 'border-[#8B5CF6]/20',
      shadow: 'shadow-[#8B5CF6]/20',
    },
    roles: [
      { id: 'admin', label: 'Admin Global', description: 'Controle total do sistema' },
    ],
    nav: [
      { id: 'usuarios', label: 'Usuarios & Cargos', icon: Users, roles: ['admin'] },
      { id: 'modulos', label: 'Config. Modulos', icon: Settings, roles: ['admin'] },
      { id: 'suporte', label: 'Suporte Central', icon: MessageSquare, roles: ['admin'] },
      { id: 'logs', label: 'Logs', icon: FileText, roles: ['admin'] },
    ],
    pages: {
      usuarios: UsersPage,
      modulos: SettingsPage,
      suporte: SupportHubPage,
      logs: LogsPage,
    },
  },
}
