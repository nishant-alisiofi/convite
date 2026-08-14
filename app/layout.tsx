import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Convite',
  description: 'Coordinación de ayuda humanitaria en la cuenca del Atrato',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-CO">
      <body>{children}</body>
    </html>
  )
}
