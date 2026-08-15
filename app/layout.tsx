import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Convite',
  description: 'Coordinación de ayuda humanitaria para el Chocó y el Pacífico colombiano',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-CO">
      <body>{children}</body>
    </html>
  )
}
