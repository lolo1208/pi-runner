---
name: Pi Runner · 行动派
description: 安静的工作台，克制、清晰、紧凑的桌面 AI 编程界面。
colors:
  bg: "#f2f2ee"
  sidebar: "#EAEAE5"
  surface: "#fdfdfa"
  text: "#252728"
  muted: "#737772"
  border: "#dfe1da"
  hover: "#e8e9e3"
  selected: "#3c4043"
  selected-text: "#fff"
  accent: "#3979dc"
  accent-foreground: "#fff"
  error-bg: "#fbe9e5"
  error: "#a33628"
  error-foreground: "#fff"
  warning: "#b96512"
  warning-foreground: "#fff"
  success-bg: "#e8f1e8"
  success: "#327046"
  code: "#eee"
  diff-add: "#22863a"
  diff-del: "#b31d28"
  bubble-bg: "#e9eff9"
  bubble-border: "#cddbf1"
  bubble-ink: "#1f2b3d"
  dark-bg: "#121314"
  dark-sidebar: "#191a1b"
  dark-surface: "#202122"
  dark-text: "#bfbfbf"
  dark-muted: "#96999a"
  dark-border: "#2a2b2c"
  dark-hover: "#2c2d2e"
  dark-selected: "#313233"
  dark-selected-text: "#ededed"
  dark-accent: "#48a0c7"
  dark-accent-foreground: "#121314"
  dark-error-bg: "#3a1d1d"
  dark-error: "#f48771"
  dark-error-foreground: "#121314"
  dark-warning: "#f0a34a"
  dark-warning-foreground: "#121314"
  dark-success-bg: "#193328"
  dark-success: "#72c892"
  dark-code: "#242526"
  dark-diff-add: "#3fb950"
  dark-diff-del: "#f85149"
  dark-bubble-bg: "#233039"
  dark-bubble-border: "#31485a"
  dark-bubble-ink: "#dde5ec"
typography:
  body:
    fontFamily: 'Inter, "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, sans-serif'
    fontSize: "calc(14rem / 14)"
  headline:
    fontSize: "calc(22rem / 14)"
    fontWeight: 500
  title:
    fontSize: "calc(17rem / 14)"
    fontWeight: 600
  label:
    fontSize: "calc(13rem / 14)"
  caption:
    fontSize: "calc(11rem / 14)"
  code:
    fontFamily: "Consolas, monospace"
    fontSize: "calc(12rem / 14)"
rounded:
  icon: "6px"
  control: "8px"
  input: "calc(0.625rem - 2px)"
  approval: "10px"
  alert: "12px"
  card: "13px"
  modal: "16px"
  badge: "20px"
  pill: "9999px"
spacing:
  tight: "4px"
  small: "8px"
  medium: "12px"
  large: "16px"
  section: "20px"
  dialog: "22px"
  roomy: "24px"
components:
  button-default:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "0.5rem 1rem"
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-foreground}"
    rounded: "{rounded.control}"
  button-destructive:
    backgroundColor: "{colors.error}"
    textColor: "{colors.error-foreground}"
    rounded: "{rounded.control}"
  button-secondary:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.input}"
    height: "2.25rem"
  nav-selected:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.selected-text}"
    rounded: "{rounded.pill}"
    height: "calc(36rem / 14)"
  badge:
    rounded: "{rounded.badge}"
    padding: "3px 10px"
  settings-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.card}"
    padding: "20px"
---

# Design System: Pi Runner · 行动派

## Overview

**Creative North Star: "安静的工作台"**

克制、清晰、紧凑。暖灰纸面承载任务与对话，细边框区分工作区域，少量强调色标记操作和执行状态。组件保持柔和圆角与轻量反馈，不与代码、差异和审批内容争夺注意力。

平面为主，浮层抬升。明暗主题共享结构与语义，但分别采用行动蓝和冷青蓝；深色主题不是浅色界面的简单反色。

**Key Characteristics:**
- 中性分区与语义强调色。
- 紧凑控件、胶囊导航与柔和容器。
- 主体平面化，弹窗与浮动面板使用阴影。

本文记录现有实现，不代表已完成视觉或无障碍验收。主要依据：`src/renderer/src/styles/base.css`、`application-layout.css`、`responsive.css`、`modal.css`、`settings.css`、`conversation.css`，以及 `components/ui/button.tsx`、`input.tsx`。本次刷新核对了上述基础样式、布局、响应式规则及组件，并补查 `styles.css` 与 `components/ui/tooltip.tsx`。未运行应用或核验截图；不将局部样式归纳为未经证实的全局规则。

## Colors

前置 YAML 为数值索引；浅色键对应 CSS 同名变量，`dark-` 键对应 `:root[data-theme="dark"]` 的同名变量覆盖。实际组件使用 CSS 变量，不直接绑定文档中的浅色值。

### Primary
- **行动蓝 / 冷青蓝**：`accent` / `dark-accent`，用于明确的主操作、链接、执行状态和文字输入焦点。
- **主操作前景**：`accent-foreground` 及其深色对应项，必须随背景一起切换。

### Neutral
- **暖灰纸面**：`bg` 为工作区，`sidebar` 为任务栏，`surface` 为字段、卡片和浮层。
- **正文与辅助墨色**：`text`、`muted` 区分内容层级；`border`、`hover` 表达轮廓与交互。
- **石墨选中态**：`selected` 配合 `selected-text`，用于当前会话。选中态不等同于强调色。
- **代码底色**：`code` 为代码区域提供轻微底色差异。

### Semantic states
- `error`、`warning`、`success` 分别服务失败、风险与成功；背景和前景按现有配对使用。
- `diff-add`、`diff-del` 专用于差异增删，不与通用状态色互换。
- `bubble-bg`、`bubble-border`、`bubble-ink` 为用户消息的淡蓝底、描边与文字，区分发言方。

**The Theme Pairing Rule.** 背景、文字、边框和状态前景按主题成组使用，不把浅色前景硬编码进深色控件。

## Typography

默认字体栈见 `typography.body`；设置支持 system、Segoe UI、微软雅黑覆盖，Tailwind 的 sans 继承 `--ui-font-family`。普通 `code` 使用 Consolas；`--font-mono` 为 Consolas、JetBrains Mono、monospace。

### Hierarchy
- **Headline**：空会话标题，偏轻的中等字重；不是全局营销展示字体。
- **Title**：章节与普通弹窗标题；次级标题另用 `calc(14rem / 14)`、500。
- **Body / Label**：界面基准与紧凑操作文字；说明常用 `calc(12rem / 14)` 或 label 层级，行高按场景为 1.7–1.9。
- **Caption**：时间、计数等辅助信息；任务时间使用等宽数字。
- **Code**：等宽字体服务代码、命令与差异，不替代普通界面文字。

字号保留源码的 rem 表达式，不将其改写成固定 px。不存在统一的展示字体、固定正文行高或全局最大行长约束。

## Layout

窗口使用 `100dvh`，标题栏高度为 `calc(44rem / 14)`。工作区由任务侧栏、弹性对话区和可选工具面板组成，内部滚动容器保持 `min-width: 0` / `min-height: 0`。

任务栏初始宽度为 `clamp(210px, 19vw, 400px)`；分隔条可拖动。工具栏在宽屏作为第三列，对话区约束最小宽度，工具宽度由剩余空间和用户拖动值共同决定，不强制三栏等宽。

设置内容居中，最大宽度（1100px），默认内边距（48px 7% 60px）。聊天横向留白使用 `clamp(40px, 4.5vw, 96px)`，虚拟列表将留白放在消息内容内以保证测量准确。

- 大于等于 1600px：设置区左右留白提高至 10%。
- 小于等于 1100px：设置区内边距收为 40px 30px，调整工具列约束。
- 小于等于 850px：工具面板改为右侧浮层，宽 `min(420px, 100%)`；设置行纵向排列，设置区内边距收为 32px 24px。
- 小于等于 600px：侧栏收为 `clamp(160px, 28vw, 184px)`，仍保留两栏；设置导航改为顶部可换行布局，表单改单列，设置区内边距为 16px、卡片内边距为 14px。用户气泡最大宽度放宽为 92%，输入区模式文字隐藏。
- 小于等于 700px：工具审批卡允许换行，操作区靠右；这是组件局部断点，不是全局布局断点。

间距索引是复用值摘要，不是强制单一网格；现有容器仍使用 6px、10px、14px 等场景值。

## Elevation & Depth

主体以底色层次和一像素边框分区，不普遍添加卡片阴影。普通模态框使用 `0 18px 55px #0003`，警示确认框使用 `0 18px 48px #0003`，窄屏工具浮层使用 `-10px 0 35px #0002`。权限菜单使用 `0 2px 8px #0002`；当前 shadcn Tooltip 本身未声明阴影。输入框保留组件自带的轻阴影。

普通遮罩为 `#0007`，叠加 3px 模糊；警示确认遮罩为 `#0008`。两者层级不同，不以增加任意 z-index 解决叠层问题。

**The Flat Workspace Rule.** 持续展示的工作区域优先使用底色和边框；阴影用于浮层及已有的局部交互层次。

## Shapes

控件以柔和圆角为主，图标按钮、审批卡、警示框、设置卡和模态框使用分级圆角，见前置索引。任务行是完全胶囊形，设置导航与任务栏操作也采用较大圆角。不要将全部组件统一成同一圆角。

shadcn Input 的 `rounded-md` 由 `styles.css` 的主题映射决定：`--radius-md: calc(var(--radius) - 2px)`，其中 `--radius: 0.625rem`；不是未覆盖的 Tailwind 默认值。基础 CSS 中未带 `data-slot` 的输入框另为 control 圆角；两者不是完全相同的实现。图标通常采用轻描边（1.5px）。

## Components

### Buttons

基于 shadcn/ui 风格的本地封装，复用 `components/ui/button.tsx`，支持 default、destructive、outline、secondary、ghost、link，以及 default、sm、lg、icon 尺寸。

默认按钮是中性表面，不是实心蓝色；主操作通过现有 primary 样式或业务样式显式赋予强调色。普通按钮悬停切换 hover，secondary 悬停亮度为 .96；危险操作使用 error 与配套前景。过渡主要为 150ms 的颜色变化。禁用状态按组件上下文处理，不强行统一透明度。

### Inputs / Fields

复用 Input / Textarea，使用 surface、border 和 muted 占位文字。Input 高度见前置索引，水平内边距为 0.75rem。文字输入聚焦显示强调色边框与轻光环；搜索框把焦点反馈放在外容器。

**当前限制**：`styles.css` 末尾覆盖了非文字输入控件的焦点 outline 与 Tailwind ring。不能把基础组件中声明的按钮焦点环描述成当前全局有效的行为；这是一项待单独处理的键盘可见性问题，本次文档任务不修改它。

### Navigation

任务行高度见 `nav-selected`，默认文字紧凑，当前会话使用石墨底与配套前景，标题从 500 加重到 600。未选中悬停采用正文色与底色的低比例混合，不改成大面积强调蓝。

编辑、删除等行内操作在悬停或相关键盘状态显示；无悬停设备常显。项目分组另有局部状态规则，不能假定全部隐藏操作都已具有一致的键盘支持。

### Chips / Badges

通用 badge 使用细边框、胶囊圆角和 caption 字号，无独立填充色。AI 审查徽标等为更紧凑的场景变体，不替换通用徽标规则。

### Cards / Containers

设置卡使用 surface、border 和 card 圆角，内部留白见前置索引；默认无阴影。工具审批卡使用 approval 圆角、12px 14px 留白，摘要可换行、辅助路径截断，操作按钮紧凑排列；窄屏允许操作区换行。

### Dialogs / Tooltips

普通 modal 居中，宽 `min(520px, calc(100vw - 40px))`，内部滚动，操作靠右；警示确认框更紧凑，宽 `min(420px, 100vw - 32px)`。代码审查与命令审批保留更大专用容器，不套用普通弹窗固定尺寸。

Tooltip 复用基于 Radix 的本地 shadcn/ui 组件，使用深灰底（`#363a3d`）白字、紧凑留白（0.375rem 0.75rem）、小箭头及淡入缩放反馈，不额外添加阴影；Provider 默认延迟为 0。浮层具体层级以组件源码为准。

### Conversation

用户消息使用独立的淡蓝语义配色；代码与差异保持可复制。界面文字默认不可选择，正文、输入、代码、诊断和差异区域明确开放选择。

动效以短暂的颜色、展开与旋转反馈为主，运行状态可持续旋转；侧栏等已有 reduced-motion 分支。不要声称全部动效都已覆盖减少动态偏好。

## Do's and Don'ts

### Do:
- **Do** 复用本地 shadcn/ui 封装及语义 CSS 变量。
- **Do** 成组验证浅色与深色的背景、前景和状态色。
- **Do** 用中性分区承载工作内容，用强调色突出操作与执行状态。
- **Do** 保留胶囊导航、分级圆角与内部滚动的桌面工作区结构。
- **Do** 让正文、代码、差异和诊断信息可选择复制。

### Don't:
- **Don't** 把默认中性按钮误当作实心主按钮。
- **Don't** 给持续展示的所有卡片统一添加浮层阴影。
- **Don't** 把差异增删色与一般成功、失败色混用。
- **Don't** 把源码中的焦点或 reduced-motion 声明当作已完成全局无障碍验收。
