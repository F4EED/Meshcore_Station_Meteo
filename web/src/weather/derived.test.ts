import { describe, expect, it } from 'vitest'
import { FACTORY_BANDS } from './factory'
import { dewPointC, feelsLikeC, fireScore, frostAssessment, smokeLikely } from './derived'
import { metricLevel } from './levels'

describe('grandeurs dérivées', () => {
  it('calcule le point de rosée Magnus–Tetens', () => {
    expect(dewPointC(20, 50)).toBeCloseTo(9.26, 1)
  })

  it('calcule le ressenti Steadman puis l’indice de chaleur', () => {
    expect(feelsLikeC(20, 50)).toBeGreaterThan(18)
    expect(feelsLikeC(20, 50)).toBeLessThan(22)
    expect(feelsLikeC(30, 40)).toBeCloseTo(29.7, 1)
  })

  it('marque le gel et laisse le temps doux à zéro', () => {
    const dew = dewPointC(-5, 96)
    expect(dew).not.toBeNull()
    const cold = frostAssessment(-5, 96, dew!)
    expect(cold.kind).toBe('gel')
    expect(cold.score).toBeGreaterThan(20)
    expect(frostAssessment(-1, 95, dewPointC(-1, 95)!).score).toBe(77)
    expect(frostAssessment(0, 100, dewPointC(0, 100)!).score).toBe(100)
    expect(frostAssessment(1, 98, dewPointC(1, 98)!).score).toBe(60)
    const mildDew = dewPointC(15, 55)!
    expect(frostAssessment(15, 55, mildDew).kind).toBe('aucun')
    expect(frostAssessment(15, 55, mildDew).score).toBe(0)
  })

  it('calcule le ressenti Steadman à 15 °C', () => {
    expect(feelsLikeC(15, 55)).toBeCloseTo(14.1, 1)
  })

  it('monte l’indice feu quand il fait chaud et sec', () => {
    expect(fireScore(30, 20)).toBe(100)
    expect(fireScore(15, 55)).toBe(2)
  })

  it('signale la fumée sans en faire un IFM', () => {
    expect(smokeLikely(220, 80_000, FACTORY_BANDS.iaq, FACTORY_BANDS.gas)).toBe(true)
    expect(smokeLikely(40, 4_000, FACTORY_BANDS.iaq, FACTORY_BANDS.gas)).toBe(true)
    expect(smokeLikely(40, 80_000, FACTORY_BANDS.iaq, FACTORY_BANDS.gas)).toBe(false)
  })

  it('colore les pastilles comme les bandes STMET', () => {
    expect(metricLevel(15, FACTORY_BANDS.temp, 'twoSided')).toBe('ok')
    expect(metricLevel(-25, FACTORY_BANDS.temp, 'twoSided')).toBe('alert')
    expect(metricLevel(36, FACTORY_BANDS.temp, 'twoSided')).toBe('warn')
    expect(metricLevel(46, FACTORY_BANDS.temp, 'twoSided')).toBe('alert')
    expect(metricLevel(160, FACTORY_BANDS.iaq, 'lowerBetter')).toBe('warn')
    expect(metricLevel(210, FACTORY_BANDS.iaq, 'lowerBetter')).toBe('alert')
    expect(metricLevel(80_000, FACTORY_BANDS.gas, 'lowerBetter')).toBe('ok')
    expect(metricLevel(970, FACTORY_BANDS.pressure, 'twoSided')).toBe('warn')
  })
})
