/**
 * `checkConsumerParameters`: each declared type, required and optional parameters, select
 * options, broken select declarations and undeclared keys. `assertConsumerParameters`: the
 * error, and the values it returns to forward.
 */

import { describe, expect, it } from 'vitest'
import type { ConsumerParameterV5 } from '../../src/ddo/types.js'
import {
  assertConsumerParameters,
  ConsumerParameterError,
  checkConsumerParameters
} from '../../src/utils/consumerParameters.js'
import { getConsumerParameters } from '../fixtures/ConsumerParameters.js'

// surname: text, required; age: number; consent: boolean; region: select (eu, us).
const declared = getConsumerParameters()

const valid = { surname: 'Doe', age: 42, consent: true, region: 'eu' }

function reasons(values: unknown, parameters = declared) {
  return checkConsumerParameters(parameters, values).map(
    ({ parameter, reason }) => `${parameter}:${reason}`
  )
}

describe('checkConsumerParameters', () => {
  it('accepts values of every declared type', () => {
    expect(checkConsumerParameters(declared, valid)).to.deep.equal([])
  })

  it('accepts only the required parameters, leaving optional ones absent', () => {
    expect(reasons({ surname: 'Doe' })).to.deep.equal([])
    expect(reasons({ surname: 'Doe', age: null })).to.deep.equal([])
  })

  it('refuses a missing required parameter, also when no values are passed', () => {
    expect(reasons({ age: 1 })).to.deep.equal(['surname:missing'])
    expect(reasons(undefined)).to.deep.equal(['surname:missing'])
    expect(reasons({ surname: null })).to.deep.equal(['surname:missing'])
  })

  it('accepts an empty string for a required text parameter', () => {
    expect(reasons({ surname: '' })).to.deep.equal([])
  })

  it('refuses a text parameter that is not a string', () => {
    expect(reasons({ surname: 7 })).to.deep.equal(['surname:wrong-type'])
  })

  it('refuses a number parameter that is a string, NaN or Infinity', () => {
    for (const age of [
      'not-a-number',
      '5',
      Number.NaN,
      Number.POSITIVE_INFINITY
    ])
      expect(reasons({ ...valid, age })).to.deep.equal(['age:wrong-type'])
  })

  it('accepts zero and negative numbers', () => {
    expect(reasons({ ...valid, age: 0 })).to.deep.equal([])
    expect(reasons({ ...valid, age: -1.5 })).to.deep.equal([])
  })

  it('refuses a boolean parameter given as a string or a number', () => {
    for (const consent of ['true', 1])
      expect(reasons({ ...valid, consent })).to.deep.equal([
        'consent:wrong-type'
      ])
  })

  it('accepts false for a boolean parameter', () => {
    expect(reasons({ ...valid, consent: false })).to.deep.equal([])
  })

  it('refuses a select value that is not one of its options', () => {
    const [issue] = checkConsumerParameters(declared, {
      ...valid,
      region: 'asia'
    })

    expect(issue.reason).to.equal('not-an-option')
    expect(issue.message).to.equal(
      `'region' must be one of 'eu', 'us', got the string "asia"`
    )
  })

  it('refuses a select value that is not a string', () => {
    expect(reasons({ ...valid, region: 1 })).to.deep.equal([
      'region:wrong-type'
    ])
  })

  it('refuses any value for a select with missing, empty or malformed options', () => {
    for (const options of [
      undefined,
      [],
      '[]',
      'not json',
      ['eu', 'us'],
      [{}],
      [null],
      { eu: 'Europe' }
    ]) {
      const parameters = [
        { ...declared[3], options }
      ] as unknown as ConsumerParameterV5[]

      for (const region of ['eu', '', 1])
        expect(reasons({ region }, parameters)).to.deep.equal([
          'region:invalid-declaration'
        ])
    }
  })

  it('names the broken select declaration in the message', () => {
    const parameters = [
      { ...declared[3], options: [] }
    ] as unknown as ConsumerParameterV5[]

    expect(checkConsumerParameters(parameters, { region: 'eu' })).to.deep.equal(
      [
        {
          parameter: 'region',
          reason: 'invalid-declaration',
          message: `'region' is declared as a select without any usable options, so no value can be accepted until the asset's declaration is fixed`
        }
      ]
    )
  })

  it('leaves an absent optional select with no options alone', () => {
    const parameters = [
      { ...declared[3], options: [] }
    ] as unknown as ConsumerParameterV5[]

    expect(reasons({}, parameters)).to.deep.equal([])
    expect(reasons({ region: null }, parameters)).to.deep.equal([])
  })

  it('reads select options stored as a JSON string', () => {
    const parameters = [
      { ...declared[3], options: JSON.stringify([{ eu: 'Europe' }]) }
    ] as unknown as ConsumerParameterV5[]

    expect(reasons({ region: 'eu' }, parameters)).to.deep.equal([])
    expect(reasons({ region: 'us' }, parameters)).to.deep.equal([
      'region:not-an-option'
    ])
  })

  it('refuses keys the asset does not declare, naming the declared ones', () => {
    const [issue] = checkConsumerParameters(declared, {
      ...valid,
      surnme: 'Doe'
    })

    expect(issue).to.deep.equal({
      parameter: 'surnme',
      reason: 'unknown',
      message: `'surnme' is not a declared parameter (declared: 'surname', 'age', 'consent', 'region')`
    })
  })

  it('passes any values through when the asset declares no parameters', () => {
    expect(reasons({ anything: 'goes' }, [])).to.deep.equal([])
    expect(
      checkConsumerParameters(undefined, { anything: 'goes' })
    ).to.deep.equal([])
  })

  it('only checks presence for a type it does not know', () => {
    const parameters = [
      { ...declared[0], type: 'date' }
    ] as unknown as ConsumerParameterV5[]

    expect(reasons({ surname: 20260101 }, parameters)).to.deep.equal([])
    expect(reasons({}, parameters)).to.deep.equal(['surname:missing'])
  })

  it('refuses values that are not an object', () => {
    for (const values of ['rows=5', [1], 5])
      expect(reasons(values)).to.deep.equal([':not-object'])
  })

  it('refuses objects that are not plain: a Date, Map, Set or class instance', () => {
    class Values {
      surname = 'Doe'
    }

    for (const values of [
      new Date(),
      new Map([['surname', 'Doe']]),
      new Set(['Doe']),
      new Values()
    ])
      expect(reasons(values)).to.deep.equal([':not-object'])

    expect(checkConsumerParameters(declared, new Values())[0].message).to.equal(
      'expected an object of parameter values, got an instance of Values'
    )
  })

  it('accepts an object without a prototype', () => {
    const values = Object.assign(Object.create(null), { surname: 'Doe' })

    expect(reasons(values)).to.deep.equal([])
  })

  it('reads only plain objects as select options', () => {
    const parameters = [
      { ...declared[3], options: [new Map([['eu', 'Europe']])] }
    ] as unknown as ConsumerParameterV5[]

    expect(reasons({ region: 'eu' }, parameters)).to.deep.equal([
      'region:invalid-declaration'
    ])
  })

  it('does not take inherited properties as values', () => {
    const parameters = [
      { ...declared[0], name: 'toString' }
    ] as unknown as ConsumerParameterV5[]

    expect(reasons({}, parameters)).to.deep.equal(['toString:missing'])
  })

  it('reports every problem at once', () => {
    expect(
      reasons({ age: 'old', consent: 'yes', region: 'asia', extra: 1 })
    ).to.deep.equal([
      'surname:missing',
      'age:wrong-type',
      'consent:wrong-type',
      'region:not-an-option',
      'extra:unknown'
    ])
  })
})

describe('assertConsumerParameters', () => {
  const target = {
    did: 'did:ope:1',
    serviceId: 'svc',
    field: 'userdata'
  } as const

  it('throws a ConsumerParameterError naming the parameter and the reason', () => {
    let thrown: unknown

    try {
      assertConsumerParameters(declared, { ...valid, age: 'x' }, target)
    } catch (error) {
      thrown = error
    }

    expect(thrown).to.be.instanceOf(ConsumerParameterError)
    const error = thrown as ConsumerParameterError
    expect(error.name).to.equal('ConsumerParameterError')
    expect(error).to.include({
      did: 'did:ope:1',
      serviceId: 'svc',
      field: 'userdata'
    })
    expect(error.issues).to.have.length(1)
    expect(error.message).to.equal(
      `Refusing userdata for service svc of did:ope:1: 'age' must be a finite number, got the string "x". Nothing was sent: consumer parameters are checked before the node is asked for a fee or any order is placed.`
    )
  })

  it('returns a copy of the values when they fit', () => {
    const values = { ...valid }
    const forwarded = assertConsumerParameters(declared, values, target)

    expect(forwarded).to.deep.equal(valid)
    expect(forwarded).not.to.equal(values)
  })

  it('drops the keys set to null or undefined, leaving the input as it was', () => {
    const values = { surname: 'Doe', age: null, consent: undefined }
    const forwarded = assertConsumerParameters(declared, values, target)

    expect(forwarded).to.deep.equal({ surname: 'Doe' })
    expect(Object.keys(forwarded ?? {})).to.deep.equal(['surname'])
    expect(values).to.deep.equal({
      surname: 'Doe',
      age: null,
      consent: undefined
    })
  })

  it('keeps falsy values that are not absent', () => {
    expect(
      assertConsumerParameters(
        declared,
        { surname: '', age: 0, consent: false },
        target
      )
    ).to.deep.equal({ surname: '', age: 0, consent: false })
  })

  it('drops null keys when the asset declares no parameters too', () => {
    expect(
      assertConsumerParameters([], { anything: 'goes', empty: null }, target)
    ).to.deep.equal({ anything: 'goes' })
  })

  it('returns undefined when no values are given', () => {
    expect(assertConsumerParameters([], undefined, target)).to.equal(undefined)
    expect(assertConsumerParameters([], null, target)).to.equal(undefined)
  })
})
