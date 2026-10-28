// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { GeneralSettingsSection } from './SettingsSections'
import type { ModelSettings } from '../../../../shared/models'
import type { Preferences } from '../../preferences'

// The app's React transform supplies this runtime; Vitest does not load electron-vite.
Object.assign(globalThis, { React })
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
Element.prototype.scrollIntoView = vi.fn()
afterEach(cleanup)
const settings: ModelSettings = { profiles: [], activeProfileId: null, reviewProfileId: null, encryptionAvailable: true }
const props = { preferences: { customPrompt: '', compressionThreshold: 90 } as Preferences, onPreferences: vi.fn(), isMac: false, settings, onModelSettingsChange: vi.fn(), onBusyChange: vi.fn() }

describe('review model setting', () => {
  it('renders and opens the off and default-model choices even without models', async () => {
    render(<GeneralSettingsSection {...props} />)
    const select = screen.getByRole('combobox', { name: '审核模型' })
    expect(select.hasAttribute('disabled')).toBe(false)
    fireEvent.keyDown(select, { key: 'ArrowDown' })
    await waitFor(() => expect(screen.getByRole('option', { name: '关闭' })).toBeTruthy())
    expect(screen.getByRole('option', { name: '使用默认模型' })).toBeTruthy()
  })
})
