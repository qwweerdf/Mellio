// 安全的计算器工具。只允许数字、基本运算符和少量数学函数，禁止变量/赋值/属性访问。

import { parse, type MathNode } from 'mathjs'
import type { AgentTool } from '../react'

const FUNCTIONS = new Set([
  'sqrt',
  'abs',
  'round',
  'floor',
  'ceil',
  'min',
  'max',
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'log',
  'log10',
  'exp',
  'pow'
])
const CONSTANTS = new Set(['pi', 'e', 'tau'])
const OPERATORS = new Set(['+', '-', '*', '/', '^', '!'])

export async function evaluateExpression(expression: string): Promise<number> {
  const source = expression.trim()
  if (!source) throw new Error('expression is empty')
  if (source.length > 200) throw new Error('expression is too long')

  const node = parse(source) as MathNode
  validate(node)
  const value = node.evaluate({})
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('expression did not produce a finite number')
  }
  return value
}

function validate(node: MathNode): void {
  const n = node as unknown as {
    type: string
    value?: unknown
    name?: string
    op?: string
    args?: MathNode[]
    content?: MathNode
    fn?: { type: string; name?: string }
  }

  switch (n.type) {
    case 'ConstantNode':
      if (typeof n.value !== 'number' || !Number.isFinite(n.value)) {
        throw new Error('only numeric constants are allowed')
      }
      return
    case 'SymbolNode':
      if (!n.name || !CONSTANTS.has(n.name)) throw new Error(`unknown symbol: ${n.name ?? '?'}`)
      return
    case 'OperatorNode':
      if (!n.op || !OPERATORS.has(n.op)) throw new Error(`operator not allowed: ${n.op ?? '?'}`)
      for (const arg of n.args ?? []) validate(arg)
      return
    case 'ParenthesisNode':
      if (!n.content) throw new Error('invalid parentheses')
      validate(n.content)
      return
    case 'FunctionNode': {
      if (n.fn?.type !== 'SymbolNode' || !n.fn.name || !FUNCTIONS.has(n.fn.name)) {
        throw new Error(`function not allowed: ${n.fn?.name ?? '?'}`)
      }
      for (const arg of n.args ?? []) validate(arg)
      return
    }
    default:
      throw new Error(`expression not allowed: ${n.type}`)
  }
}

export const calculatorTool: AgentTool = {
  name: 'calculator',
  description:
    'Evaluate a mathematical expression exactly. Use for arithmetic; do not calculate in your head. Supports + - * / ^ !, parentheses, sqrt, abs, round, floor, ceil, min, max, sin, cos, tan, log, log10, exp, pow, pi and e.',
  parameters: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: 'A single math expression, e.g. "(12 + 8) * 3" or "sqrt(144)".'
      }
    },
    required: ['expression'],
    additionalProperties: false
  },
  async run(args: unknown): Promise<unknown> {
    if (!args || typeof args !== 'object' || typeof (args as { expression?: unknown }).expression !== 'string') {
      throw new Error('calculator expects { expression: string }')
    }
    const expression = (args as { expression: string }).expression
    return { expression, value: await evaluateExpression(expression) }
  }
}
