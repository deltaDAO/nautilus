import type { ConsumerParameterV5 } from '../../src/ddo/types.js'
import { ConsumerParameterBuilder } from '../../src/Nautilus/Asset/ConsumerParameters/ConsumerParameterBuilder.js'

/** One parameter of each type, exercising the v5 array-options and typed-default shapes. */
export function getConsumerParameters(): ConsumerParameterV5[] {
  const builder = new ConsumerParameterBuilder()

  const text = builder
    .setType('text')
    .setName('surname')
    .setLabel('Surname')
    .setDescription('Your surname')
    .setRequired(true)
    .setDefault('unknown')
    .build()

  builder.reset()
  const number = builder
    .setType('number')
    .setName('age')
    .setLabel('Age')
    .setDescription('Your age')
    .setDefault(0)
    .build()

  builder.reset()
  const boolean = builder
    .setType('boolean')
    .setName('consent')
    .setLabel('Consent')
    .setDescription('Do you consent?')
    .setDefault(false)
    .build()

  builder.reset()
  const select = builder
    .setType('select')
    .setName('region')
    .setLabel('Region')
    .setDescription('Pick a region')
    .setDefault('eu')
    .addOption({ eu: 'Europe' })
    .addOption({ us: 'United States' })
    .build()

  return [text, number, boolean, select]
}
