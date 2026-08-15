import type { Metadata } from 'next'
import { Bricolage_Grotesque, Hanken_Grotesk, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import QueryProvider from '@/components/QueryProvider'

const display = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
  weight: ['500', '600', '700', '800'],
})

const sans = Hanken_Grotesk({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
})

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Procovar Delivery',
  description: 'Delivery Route Optimization & Pricing Platform',
  // El mismo isotipo que el resto de las aplicaciones de Procovar. En claro sale
  // el cuadrado azul; en oscuro se invierte, porque sobre una pestaña negra el
  // azul se pierde. Lo único que cambia entre aplicaciones es el nombre.
  icons: {
    icon: [
      { url: '/favicon-oscuro.svg', type: 'image/svg+xml', media: '(prefers-color-scheme: dark)' },
      { url: '/favicon-claro.svg', type: 'image/svg+xml' },
    ],
    apple: '/logo-512.png',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body className="font-sans antialiased">
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  )
}
