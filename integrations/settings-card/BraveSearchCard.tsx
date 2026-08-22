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
      <ValueField
        id="plugin-config-brave-search-endpoint"
        label={t('braveSearchBaseUrl')}
        hint={t('braveSearchBaseUrlHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.baseURL}
        onEdit={(text) => { props.edit('baseURL', text) }}
        onReset={() => { props.resetField('baseURL') }}
      />
      <ValueField
        id="plugin-config-brave-search-count"
        label={t('braveSearchNumResults')}
        hint={t('braveSearchNumResultsHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={disabled}
        {...state.numResults}
        onEdit={(text) => { props.edit('numResults', text) }}
        onReset={() => { props.resetField('numResults') }}
      />
      <ValueField
        id="plugin-config-brave-search-country"
        label={t('braveSearchCountry')}
        hint={t('braveSearchCountryHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.country}
        onEdit={(text) => { props.edit('country', text) }}
        onReset={() => { props.resetField('country') }}
      />
      <ValueField
        id="plugin-config-brave-search-language"
        label={t('braveSearchLanguage')}
        hint={t('braveSearchLanguageHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.searchLang}
        onEdit={(text) => { props.edit('searchLang', text) }}
        onReset={() => { props.resetField('searchLang') }}
      />
      <ValueField
        id="plugin-config-brave-search-safesearch"
        label={t('braveSearchSafeSearch')}
        hint={t('braveSearchSafeSearchHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.safeSearch}
        onEdit={(text) => { props.edit('safeSearch', text) }}
        onReset={() => { props.resetField('safeSearch') }}
      />
      <ValueField
        id="plugin-config-brave-search-freshness"
        label={t('braveSearchFreshness')}
        hint={t('braveSearchFreshnessHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.freshness}
        onEdit={(text) => { props.edit('freshness', text) }}
        onReset={() => { props.resetField('freshness') }}
      />
    </PluginCard>
  )
}
