/**
 * The Brave search provider's card: its endpoint, result-count default,
 * region and language bias, SafeSearch and freshness filters, and the key —
 * which is written through the credentials domain, never into the settings
 * section, so the literal never rides a response.
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { SecretField, ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type { BraveSearchCardFace } from './brave-search-card-controller.ts'
import type {} from './slot-contract.ts'

/** Props the renderer binds for the Brave search card. */
export type BraveSearchCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<BraveSearchCardFace>

/** One plain-text option row: its state member and locale keys. */
interface OptionRow {
  readonly name: 'baseURL' | 'numResults' | 'country' | 'searchLang' | 'safeSearch' | 'freshness'
  readonly id: string
  readonly label: 'braveSearchBaseUrl' | 'braveSearchNumResults' | 'braveSearchCountry' | 'braveSearchLanguage' | 'braveSearchSafeSearch' | 'braveSearchFreshness'
  readonly hint: 'braveSearchBaseUrlHint' | 'braveSearchNumResultsHint' | 'braveSearchCountryHint' | 'braveSearchLanguageHint' | 'braveSearchSafeSearchHint' | 'braveSearchFreshnessHint'
  /** True when the value must parse as a number. */
  readonly numeric?: boolean
}

const OPTION_ROWS: readonly OptionRow[] = [
  { name: 'baseURL', id: 'endpoint', label: 'braveSearchBaseUrl', hint: 'braveSearchBaseUrlHint' },
  { name: 'numResults', id: 'count', label: 'braveSearchNumResults', hint: 'braveSearchNumResultsHint', numeric: true },
  { name: 'country', id: 'country', label: 'braveSearchCountry', hint: 'braveSearchCountryHint' },
  { name: 'searchLang', id: 'language', label: 'braveSearchLanguage', hint: 'braveSearchLanguageHint' },
  { name: 'safeSearch', id: 'safesearch', label: 'braveSearchSafeSearch', hint: 'braveSearchSafeSearchHint' },
  { name: 'freshness', id: 'freshness', label: 'braveSearchFreshness', hint: 'braveSearchFreshnessHint' },
]

/**
 * Render the Brave search card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function BraveSearchCard(props: BraveSearchCardProps) {
  const { t } = props
  const state = props.useBraveSearchCard(snapshot => snapshot)
  const disabled = !state.writable
  return (
    <PluginCard
      t={t}
      titleKey="braveSearchTitle"
      descriptionKey="braveSearchDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <SecretField
        id="plugin-config-brave-search-key"
        label={t('braveSearchApiKey')}
        hint={t('braveSearchApiKeyHint')}
        // The credentials domain accepts a key even when the settings document
        // itself is read-only; they are separate stores with separate refusals.
        // Its own writability is what disables this control — a key sourced
        // from the process environment cannot be written from here.
        disabled={!state.apiKeyWritable}
        text={state.apiKey.text}
        configured={state.apiKeyConfigured}
        stateLabel={state.apiKeyConfigured ? t('braveSearchApiKeySet') : t('braveSearchApiKeyUnset')}
        onEdit={(text) => { props.edit('apiKey', text) }}
      />
      {OPTION_ROWS.map(row => (
        <ValueField
          key={row.name}
          id={`plugin-config-brave-search-${row.id}`}
          label={t(row.label)}
          hint={t(row.hint)}
          overriddenLabel={t('overridden')}
          resetLabel={t('reset')}
          invalidLabel={t('invalidNumber')}
          numeric={row.numeric === true}
          disabled={disabled}
          {...state[row.name]}
          onEdit={(text) => { props.edit(row.name, text) }}
          onReset={() => { props.resetField(row.name) }}
        />
      ))}
    </PluginCard>
  )
}
