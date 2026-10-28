// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { Tooltip } from 'radix-ui'
import { AiReviewBadge } from './AiReviewBadge'
import { CommandApprovalDialog } from './CommandApprovalDialog'
import { ToolApprovalCard } from './ToolApprovalCard'
import { ToolApprovalDiffDialog } from './ToolApprovalDiffDialog'
import type { ToolApproval } from '../../../../shared/models'

Object.assign(globalThis, { React })
afterEach(cleanup)
const label = 'AI 已评估，需你确认'
const approval: ToolApproval = { id: 'a', toolCallId: 't', tool: 'powershell', args: { command: 'custom-tool' }, cwd: 'D:/project', reason: '需要确认' }
const props = { repeat: false, onRepeatChange: vi.fn(), onRespond: vi.fn(async () => {}) }

describe('AI 审核提示', () => {
  it('仅显式标记时显示，并提供中文悬停提示', () => {
    const { rerender } = render(<AiReviewBadge />)
    expect(screen.queryByRole('img', { name: label })).toBeNull()
    rerender(<AiReviewBadge show />)
    expect(screen.getByRole('img', { name: label }).getAttribute('title')).toBe(label)
  })
  it.each([true, undefined])('终端弹框标题跟随审核来源显示标识：%s', aiReviewed => {
    render(<Tooltip.Provider><CommandApprovalDialog open onOpenChange={vi.fn()} approval={{ ...approval, aiReviewed }} {...props} /></Tooltip.Provider>)
    const heading = screen.getByRole('heading', { name: /请求执行终端命令/ })
    expect(Boolean(within(heading).queryByRole('img', { name: label }))).toBe(Boolean(aiReviewed))
  })
  it('普通审批卡片标题也显示同一标识', () => {
    render(<ToolApprovalCard approval={{ ...approval, aiReviewed: true }} onViewDetails={vi.fn()} {...props} />)
    expect(screen.getByText('请求执行终端命令').querySelector('[aria-label]')?.getAttribute('aria-label')).toBe(label)
  })
  it.each([true, undefined])('非命令操作弹框标题跟随审核来源显示标识：%s', aiReviewed => {
    render(<ToolApprovalDiffDialog open onOpenChange={vi.fn()} approvals={[{ ...approval, tool: 'mkdir', args: { path: 'D:/outside/new-dir' }, aiReviewed }]} getPreview={vi.fn()} />)
    const heading = screen.getByRole('heading', { name: /执行操作/ })
    expect(Boolean(within(heading).queryByRole('img', { name: label }))).toBe(Boolean(aiReviewed))
  })
})
