import { describe, it, expect } from 'vitest'
import { makeRect, makeDiamond, makeEllipse, makeArrow } from './elements'

describe('makeRect', () => {
  it('returns two elements: shape and text', () => {
    const els = makeRect('r1', 200, 100, 'Login')
    expect(els).toHaveLength(2)
    expect(els[0].type).toBe('rectangle')
    expect(els[1].type).toBe('text')
  })

  it('text element has containerId pointing to shape', () => {
    const els = makeRect('r1', 200, 100, 'Login')
    expect(els[1].containerId).toBe('r1')
  })

  it('shape lists text element in boundElements', () => {
    const els = makeRect('r1', 200, 100, 'Login')
    expect(els[0].boundElements).toContainEqual({ type: 'text', id: 'r1_t' })
  })

  it('text content matches label', () => {
    const els = makeRect('r1', 200, 100, 'Login')
    expect(els[1].text).toBe('Login')
  })
})

describe('makeDiamond', () => {
  it('returns diamond type shape and text', () => {
    const els = makeDiamond('d1', 200, 200, 'Valid?')
    expect(els).toHaveLength(2)
    expect(els[0].type).toBe('diamond')
    expect(els[1].containerId).toBe('d1')
  })
})

describe('makeEllipse', () => {
  it('returns ellipse type shape and text', () => {
    const els = makeEllipse('e1', 200, 50, 'Start')
    expect(els).toHaveLength(2)
    expect(els[0].type).toBe('ellipse')
  })
})

describe('makeArrow', () => {
  const from = { id: 'r1', x: 200, y: 100, width: 200, height: 60 }
  const to   = { id: 'r2', x: 200, y: 260, width: 200, height: 60 }

  it('returns one arrow without label', () => {
    const els = makeArrow('a1', from, to)
    expect(els).toHaveLength(1)
    expect(els[0].type).toBe('arrow')
  })

  it('returns arrow + label text when label provided', () => {
    const els = makeArrow('a1', from, to, 'Yes')
    expect(els).toHaveLength(2)
    expect(els[1].type).toBe('text')
    expect(els[1].text).toBe('Yes')
  })

  it('binds to fromEl and toEl by id', () => {
    const els = makeArrow('a1', from, to)
    expect(els[0].startBinding!.elementId).toBe('r1')
    expect(els[0].endBinding!.elementId).toBe('r2')
  })

  it('arrow origin is bottom-center of fromEl', () => {
    const els = makeArrow('a1', from, to)
    // from.x + from.width/2 = 200 + 100 = 300
    // from.y + from.height  = 100 + 60  = 160
    expect(els[0].x).toBe(300)
    expect(els[0].y).toBe(160)
  })

  it('handles same-position source and target without crashing', () => {
    const same = { id: 'r1', x: 200, y: 100, width: 200, height: 60 }
    const els = makeArrow('a1', same, same)
    expect(els).toHaveLength(1)
    expect(els[0].type).toBe('arrow')
  })

  it('handles empty string label', () => {
    const els = makeArrow('a1', from, to, '')
    expect(els).toHaveLength(2)
    expect(els[1].type).toBe('text')
    expect(els[1].text).toBe('')
  })
})
