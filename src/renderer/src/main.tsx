import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/funnel-sans'
import '@fontsource-variable/funnel-display'
import '@fontsource/dm-mono/400.css'
import '@fontsource/dm-mono/500.css'
import '@astryxdesign/theme-neutral/fonts.css'
import '@astryxdesign/core/reset.css'
import '@astryxdesign/core/astryx.css'
import '@astryxdesign/theme-neutral/theme.css'
import './styles.css'
import { LinkProvider } from '@astryxdesign/core/Link'
import { Theme } from '@astryxdesign/core/theme'
import { mellioTheme } from './astryxTheme'
import App from './App'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <Theme theme={mellioTheme} mode="dark">
      <LinkProvider
        component={({ href, children, ...props }: { href?: string; children?: React.ReactNode }) => (
          <a {...props} href={href} target="_blank" rel="noreferrer">
            {children}
          </a>
        )}
      >
        <App />
      </LinkProvider>
    </Theme>
  </StrictMode>
)
