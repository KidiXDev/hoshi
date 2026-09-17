<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useDebounceFn } from '@vueuse/core';
import {
  Image as ImageIcon,
  Loader2,
  ShieldCheck,
  Tag,
  Trash2,
  Wifi
} from '@lucide/vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  clearBooruCache,
  fetchBooruSettings,
  fetchBooruSources,
  saveBooruSettings,
  solveBooruCloudflare,
  testBooruCredentials,
  type BooruCredentials,
  type BooruSettings,
  type BooruSettingsUpdate,
  type BooruSource
} from '@/services/booruGallery';
import { BRAND_NAME } from '@/lib/brand';
import { loadAppData, saveAppData } from '@/services/appStorage';
import NoticeBanner from '@/components/layout/NoticeBanner.vue';
import SettingsSection from '@/components/layout/SettingsSection.vue';
import BooruAccountCard from './BooruAccountCard.vue';

type AccountSource = 'danbooru' | 'gelbooru' | 'rule34' | 'konachan.com';
const ACCOUNT_LABELS: Record<AccountSource, string> = {
  danbooru: 'Danbooru',
  gelbooru: 'Gelbooru',
  rule34: 'Rule34',
  'konachan.com': 'Konachan'
};

const emit = defineEmits<{ saved: [] }>();
function showSaved() {
  emit('saved');
}
const booruSettings = ref<BooruSettings | null>(null);
const booruSources = ref<BooruSource[]>([]);
const booruAvailable = ref<boolean | null>(null);
const emptyCredentials = (): BooruCredentials => ({
  danbooru: { username: '', apiKey: '' },
  gelbooru: { userId: '', apiKey: '' },
  rule34: { userId: '', apiKey: '' },
  konachan: { cookie: '', userAgent: '' }
});
const booruCredentials = ref<BooruCredentials>(emptyCredentials());
const showKonachanManual = ref(false);
const isSolvingKonachan = ref(false);
const booruDefaultSource = ref('danbooru');
const booruBlacklist = ref('');
const booruOutputFilterTags = ref('');
const booruPromptCategories = ref<string[]>([
  'copyright',
  'character',
  'general'
]);
const booruReplaceUnderscores = ref(false);
const booruEscapeParentheses = ref(false);
const booruTimeout = ref(30);
const booruCacheBudget = ref(1024);
const booruCacheMessage = ref('');
const booruTesting = ref<AccountSource | null>(null);
const booruResult = ref<{
  source: AccountSource;
  ok: boolean;
  message: string;
} | null>(null);
function resultFor(source: AccountSource) {
  return booruResult.value?.source === source ? booruResult.value : null;
}
async function loadBooruPromptFormatOptions() {
  try {
    const saved = await loadAppData<{
      replaceUnderscores?: boolean;
      escapeParentheses?: boolean;
    }>('booru_prompt_format_options');
    if (saved) {
      if (typeof saved.replaceUnderscores === 'boolean') {
        booruReplaceUnderscores.value = saved.replaceUnderscores;
      }
      if (typeof saved.escapeParentheses === 'boolean') {
        booruEscapeParentheses.value = saved.escapeParentheses;
      }
    }
  } catch (error) {
    console.warn('Failed to load booru prompt format options:', error);
  }
}
const danbooruConfigured = computed(
  () =>
    booruSettings.value?.credentialStatus.danbooru?.hasUsername &&
    booruSettings.value?.credentialStatus.danbooru?.hasApiKey
);
const gelbooruConfigured = computed(
  () =>
    booruSettings.value?.credentialStatus.gelbooru?.hasUserId &&
    booruSettings.value?.credentialStatus.gelbooru?.hasApiKey
);
const rule34Configured = computed(
  () =>
    booruSettings.value?.credentialStatus.rule34?.hasUserId &&
    booruSettings.value?.credentialStatus.rule34?.hasApiKey
);
const konachanConfigured = computed(() =>
  Boolean(booruSettings.value?.credentialStatus.konachan?.hasCookie)
);
const BOORU_PROMPT_CATEGORIES = [
  'artist',
  'copyright',
  'character',
  'general',
  'meta'
];
let applyingGallerySettings = false;
function applyGallerySettings(settings: BooruSettings) {
  applyingGallerySettings = true;
  try {
    booruSettings.value = settings;
    booruDefaultSource.value = settings.defaultSource;
    booruBlacklist.value = settings.blacklist.join(', ');
    booruOutputFilterTags.value = settings.outputFilterTags.join(', ');
    booruPromptCategories.value = [...settings.promptDefaults.categories];
    booruReplaceUnderscores.value = settings.promptDefaults.replaceUnderscores;
    booruEscapeParentheses.value = settings.promptDefaults.escapeParentheses;
    booruTimeout.value = settings.timeout;
    booruCacheBudget.value = settings.cacheBudgetMiB;
  } finally {
    applyingGallerySettings = false;
  }
}
async function loadGallerySettings() {
  try {
    const [settings, sources] = await Promise.all([
      fetchBooruSettings(),
      fetchBooruSources()
    ]);
    booruSources.value = sources;
    applyGallerySettings(settings);
    booruAvailable.value = true;
  } catch {
    booruAvailable.value = false;
    booruSettings.value = null;
  }
}
function parseTagList(value: string) {
  return [
    ...new Set(
      value
        .split(/[,，、\r\n]+/u)
        .map((tag) => tag.trim())
        .filter(Boolean)
    )
  ];
}
function togglePromptCategory(category: string) {
  booruPromptCategories.value = booruPromptCategories.value.includes(category)
    ? booruPromptCategories.value.filter((item) => item !== category)
    : [...booruPromptCategories.value, category];
}
async function saveGalleryPreferences() {
  if (booruAvailable.value) {
    const credentials: Partial<BooruCredentials> = {};
    if (
      booruCredentials.value.danbooru.username &&
      booruCredentials.value.danbooru.apiKey
    ) {
      credentials.danbooru = booruCredentials.value.danbooru;
    }
    if (
      booruCredentials.value.gelbooru.userId &&
      booruCredentials.value.gelbooru.apiKey
    ) {
      credentials.gelbooru = booruCredentials.value.gelbooru;
    }
    if (
      booruCredentials.value.rule34.userId &&
      booruCredentials.value.rule34.apiKey
    ) {
      credentials.rule34 = booruCredentials.value.rule34;
    }
    if (
      booruCredentials.value.konachan.cookie ||
      booruCredentials.value.konachan.userAgent
    ) {
      credentials.konachan = booruCredentials.value.konachan;
    }
    booruTimeout.value = Math.min(
      300,
      Math.max(3, Number(booruTimeout.value) || 30)
    );
    booruCacheBudget.value = Math.min(
      32768,
      Math.max(128, Number(booruCacheBudget.value) || 1024)
    );
    const update: BooruSettingsUpdate = {
      defaultSource: booruDefaultSource.value,
      blacklist: parseTagList(booruBlacklist.value),
      outputFilterTags: parseTagList(booruOutputFilterTags.value),
      promptDefaults: {
        categories: booruPromptCategories.value,
        replaceUnderscores: booruReplaceUnderscores.value,
        escapeParentheses: booruEscapeParentheses.value
      },
      timeout: booruTimeout.value,
      cacheBudgetMiB: booruCacheBudget.value,
      ...(Object.keys(credentials).length > 0 ? { credentials } : {})
    };
    applyGallerySettings(await saveBooruSettings(update));
    if (Object.keys(credentials).length > 0) {
      applyingGallerySettings = true;
      booruCredentials.value = emptyCredentials();
      applyingGallerySettings = false;
    }
    showSaved();
  }
}
const autosaveGalleryPreferences = useDebounceFn(
  () => void saveGalleryPreferences().catch(console.error),
  600
);
watch(
  [
    booruDefaultSource,
    booruBlacklist,
    booruOutputFilterTags,
    booruPromptCategories,
    booruReplaceUnderscores,
    booruEscapeParentheses,
    booruTimeout,
    booruCacheBudget,
    booruCredentials
  ],
  () => {
    if (!applyingGallerySettings) autosaveGalleryPreferences();
  },
  { deep: true, flush: 'sync' }
);
watch([booruReplaceUnderscores, booruEscapeParentheses], ([rep, esc]) => {
  void saveAppData('booru_prompt_format_options', {
    replaceUnderscores: rep,
    escapeParentheses: esc
  }).catch(console.error);
});

async function testBooruAccount(source: AccountSource) {
  booruTesting.value = source;
  booruResult.value = null;
  try {
    const creds =
      source === 'konachan.com'
        ? booruCredentials.value.konachan
        : booruCredentials.value[source];
    await testBooruCredentials(source, {
      ...creds
    });
    booruResult.value = {
      source,
      ok: true,
      message: `${ACCOUNT_LABELS[source]} connection succeeded.`
    };
  } catch (error) {
    booruResult.value = {
      source,
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    };
  } finally {
    booruTesting.value = null;
  }
}

async function solveKonachanCloudflare() {
  if (isSolvingKonachan.value) return;
  isSolvingKonachan.value = true;
  booruResult.value = null;
  try {
    const res = await solveBooruCloudflare('konachan.com');
    await loadGallerySettings();
    booruResult.value = {
      source: 'konachan.com',
      ok: true,
      message: res.message || 'Cloudflare clearance verified and saved!'
    };
  } catch (error) {
    booruResult.value = {
      source: 'konachan.com',
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    };
  } finally {
    isSolvingKonachan.value = false;
  }
}

async function clearKonachanCredentials() {
  if (!booruAvailable.value) return;
  applyingGallerySettings = true;
  try {
    applyGallerySettings(
      await saveBooruSettings({
        clearCredentials: { konachan: ['cookie', 'userAgent'] }
      })
    );
    booruCredentials.value.konachan = { cookie: '', userAgent: '' };
    booruResult.value = null;
    showSaved();
  } finally {
    applyingGallerySettings = false;
  }
}
async function clearGalleryCache() {
  booruCacheMessage.value = '';
  try {
    await clearBooruCache();
    booruCacheMessage.value = 'Gallery cache cleared successfully.';
  } catch (error) {
    booruCacheMessage.value =
      error instanceof Error ? error.message : String(error);
  }
}
onMounted(() => {
  void loadBooruPromptFormatOptions();
  void loadGallerySettings();
});
</script>
<template>
  <SettingsSection
    title="Booru Gallery & Provider Credentials"
    icon-class="text-purple-400"
  >
    <template #icon>
      <ImageIcon class="h-3.5 w-3.5" />
    </template>
    <template #actions>
      <Badge
        v-if="booruAvailable"
        variant="outline"
        class="border-emerald-500/30 bg-emerald-500/10 text-xs font-medium text-emerald-400"
      >
        Active
      </Badge>
    </template>

    <NoticeBanner v-if="!booruAvailable">
      Native Booru Gallery settings could not be loaded.
    </NoticeBanner>

    <!-- General Booru Config -->
    <div
      class="grid grid-cols-1 gap-4 lg:grid-cols-2"
      :class="{ 'pointer-events-none opacity-50': !booruAvailable }"
    >
      <div
        class="border-border/80 bg-muted/20 flex flex-col gap-3 rounded-lg border p-4"
      >
        <Label class="text-foreground text-xs font-semibold">
          Default Source
        </Label>
        <Select v-model="booruDefaultSource" :disabled="!booruAvailable">
          <SelectTrigger class="w-full text-xs">
            <SelectValue placeholder="Default source">
              {{
                booruSources.find(
                  (source) => source.source === booruDefaultSource
                )?.displayName ?? booruDefaultSource
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup class="max-h-40 overflow-y-auto">
              <SelectItem
                v-for="source in booruSources"
                :key="source.source"
                :value="source.source"
              >
                {{ source.displayName }}
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      <div
        class="border-border/80 bg-muted/20 flex flex-col gap-3 rounded-lg border p-4"
      >
        <Label class="text-foreground text-xs font-semibold">
          Network & Storage Cache
        </Label>
        <div class="grid grid-cols-2 gap-3">
          <Field class="gap-1.5">
            <FieldLabel class="text-xs">Timeout (seconds)</FieldLabel>
            <Input
              v-model="booruTimeout"
              type="number"
              min="3"
              max="300"
              :disabled="!booruAvailable"
              class="font-mono text-xs"
            />
          </Field>
          <Field class="gap-1.5">
            <FieldLabel class="text-xs">Cache Budget (MiB)</FieldLabel>
            <Input
              v-model="booruCacheBudget"
              type="number"
              min="128"
              max="32768"
              :disabled="!booruAvailable"
              class="font-mono text-xs"
            />
          </Field>
        </div>
        <div class="flex items-center justify-between pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            :disabled="!booruAvailable"
            class="border-border bg-secondary hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 text-xs font-medium"
            @click="clearGalleryCache"
          >
            <Trash2 class="h-3.5 w-3.5" />
            <span>Clear Cache</span>
          </Button>
          <span
            v-if="booruCacheMessage"
            class="font-mono text-xs text-emerald-400"
          >
            {{ booruCacheMessage }}
          </span>
        </div>
      </div>
    </div>

    <!-- Tag Filtering & Blacklist -->
    <div
      class="grid grid-cols-1 gap-4 lg:grid-cols-2"
      :class="{ 'pointer-events-none opacity-50': !booruAvailable }"
    >
      <Field class="gap-1.5">
        <FieldLabel class="text-foreground text-xs font-semibold">
          Content Blacklist
        </FieldLabel>
        <Textarea
          v-model="booruBlacklist"
          :disabled="!booruAvailable"
          rows="3"
          placeholder="e.g. loli, shota, gore"
          class="border-border bg-secondary/50 font-mono text-xs"
        />
      </Field>

      <Field class="gap-1.5">
        <FieldLabel class="text-foreground text-xs font-semibold">
          Prompt Output Filter
        </FieldLabel>
        <Textarea
          v-model="booruOutputFilterTags"
          :disabled="!booruAvailable"
          rows="3"
          placeholder="e.g. watermark, signature, blurry"
          class="border-border bg-secondary/50 font-mono text-xs"
        />
      </Field>
    </div>

    <!-- Prompt Defaults & Category Toggles -->
    <div
      class="border-border/80 bg-muted/20 flex flex-col gap-3.5 rounded-lg border p-4"
      :class="{ 'pointer-events-none opacity-50': !booruAvailable }"
    >
      <Label class="text-foreground text-xs font-semibold">
        Prompt Extraction Defaults
      </Label>

      <div class="flex flex-wrap gap-2">
        <button
          v-for="category in BOORU_PROMPT_CATEGORIES"
          :key="category"
          type="button"
          :disabled="!booruAvailable"
          class="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium capitalize transition-all"
          :class="
            booruPromptCategories.includes(category)
              ? 'border-primary/50 bg-primary/15 text-primary shadow-xs'
              : 'border-border bg-secondary/50 text-muted-foreground hover:text-foreground'
          "
          @click="togglePromptCategory(category)"
        >
          <Tag class="h-3 w-3" />
          <span>{{ category }}</span>
        </button>
      </div>

      <div class="grid grid-cols-1 gap-3 pt-1 sm:grid-cols-2">
        <div
          class="border-border/60 bg-card/60 flex items-center justify-between rounded-lg border p-2.5"
        >
          <span class="text-foreground text-xs font-medium">
            Replace underscores with spaces
          </span>
          <Switch v-model="booruReplaceUnderscores" />
        </div>
        <div
          class="border-border/60 bg-card/60 flex items-center justify-between rounded-lg border p-2.5"
        >
          <span class="text-foreground text-xs font-medium">
            Escape prompt parentheses
          </span>
          <Switch v-model="booruEscapeParentheses" />
        </div>
      </div>
    </div>

    <!-- Provider API Accounts -->
    <div
      class="border-border/80 flex items-center justify-between border-t pt-3"
    >
      <span
        class="text-muted-foreground text-xs font-bold tracking-wider uppercase"
      >
        Provider API Credentials
      </span>
      <span class="text-muted-foreground text-xs">
        Credentials are stored locally in {{ BRAND_NAME }} settings
      </span>
    </div>

    <div
      class="grid grid-cols-1 gap-4 lg:grid-cols-2"
      :class="{ 'pointer-events-none opacity-50': !booruAvailable }"
    >
      <BooruAccountCard
        v-model:id="booruCredentials.danbooru.username"
        v-model:secret="booruCredentials.danbooru.apiKey"
        title="Danbooru"
        :configured="Boolean(danbooruConfigured)"
        :disabled="!booruAvailable"
        id-placeholder="Username"
        key-placeholder="API Key"
        :testing="booruTesting === 'danbooru'"
        :test-disabled="booruTesting !== null"
        :result="resultFor('danbooru')"
        @test="testBooruAccount('danbooru')"
      />

      <BooruAccountCard
        v-model:id="booruCredentials.gelbooru.userId"
        v-model:secret="booruCredentials.gelbooru.apiKey"
        title="Gelbooru"
        subtitle="User ID & API Key"
        :configured="Boolean(gelbooruConfigured)"
        :disabled="!booruAvailable"
        id-placeholder="User ID (numeric)"
        key-placeholder="API Key or copied account fragment"
        :testing="booruTesting === 'gelbooru'"
        :test-disabled="booruTesting !== null"
        :result="resultFor('gelbooru')"
        @test="testBooruAccount('gelbooru')"
      />

      <BooruAccountCard
        v-model:id="booruCredentials.rule34.userId"
        v-model:secret="booruCredentials.rule34.apiKey"
        title="Rule34"
        subtitle="User ID & API Key (My Account > Options)"
        :configured="Boolean(rule34Configured)"
        :disabled="!booruAvailable"
        id-placeholder="User ID (numeric)"
        key-placeholder="API Key or copied account fragment"
        :testing="booruTesting === 'rule34'"
        :test-disabled="booruTesting !== null"
        :result="resultFor('rule34')"
        @test="testBooruAccount('rule34')"
      />

      <!-- Konachan (konachan.com) Cloudflare Card -->
      <div
        class="border-border/80 bg-muted/20 flex flex-col gap-3 rounded-lg border p-4 shadow-2xs lg:col-span-2"
      >
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <ShieldCheck class="text-primary h-4 w-4" />
            <div>
              <Label class="text-foreground text-xs font-semibold">
                Konachan (konachan.com)
              </Label>
              <p class="text-muted-foreground text-xs">
                Cloudflare Bypass Session & Credentials
              </p>
            </div>
          </div>
          <Badge
            variant="outline"
            :class="
              konachanConfigured
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-400'
            "
            class="font-mono text-xs"
          >
            <span
              class="mr-1.5 h-1.5 w-1.5 rounded-full"
              :class="konachanConfigured ? 'bg-emerald-400' : 'bg-amber-400'"
            />
            {{
              konachanConfigured ? 'Clearance Active' : 'Verification Required'
            }}
          </Badge>
        </div>

        <p class="text-muted-foreground text-xs">
          konachan.com requires Cloudflare verification. Solve the challenge via
          the in-app browser popup below, or manually paste your browser session
          cookie.
        </p>

        <div class="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            :disabled="!booruAvailable || isSolvingKonachan"
            class="cursor-pointer bg-amber-600 text-xs font-medium text-white shadow-xs hover:bg-amber-500"
            @click="solveKonachanCloudflare"
          >
            <Loader2
              v-if="isSolvingKonachan"
              class="mr-1.5 h-3.5 w-3.5 animate-spin"
            />
            <ShieldCheck v-else class="mr-1.5 h-3.5 w-3.5" />
            <span>{{
              isSolvingKonachan
                ? 'Verifying in window...'
                : 'Solve Cloudflare Challenge'
            }}</span>
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            :disabled="!booruAvailable || booruTesting !== null"
            class="border-border bg-secondary cursor-pointer text-xs font-medium"
            @click="testBooruAccount('konachan.com')"
          >
            <Loader2
              v-if="booruTesting === 'konachan.com'"
              class="h-3.5 w-3.5 animate-spin"
            />
            <Wifi v-else class="h-3.5 w-3.5" />
            <span>Test Connection</span>
          </Button>

          <Button
            v-if="konachanConfigured"
            type="button"
            variant="ghost"
            size="sm"
            class="text-muted-foreground hover:text-destructive cursor-pointer text-xs"
            @click="clearKonachanCredentials"
          >
            <Trash2 class="mr-1 h-3.5 w-3.5" />
            <span>Clear Session</span>
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            class="text-muted-foreground ml-auto cursor-pointer text-xs"
            @click="showKonachanManual = !showKonachanManual"
          >
            <span>{{
              showKonachanManual
                ? 'Hide Manual Inputs'
                : 'Manual Cookie / User-Agent'
            }}</span>
          </Button>
        </div>

        <div
          v-if="showKonachanManual"
          class="border-border/50 space-y-3 border-t pt-2"
        >
          <div class="space-y-1">
            <Label class="text-muted-foreground text-xs">
              Session Cookie (containing cf_clearance)
            </Label>
            <Input
              v-model="booruCredentials.konachan.cookie"
              :disabled="!booruAvailable"
              autocomplete="off"
              placeholder="cf_clearance=...; path=/; domain=.konachan.com"
              class="font-mono text-xs"
            />
          </div>
          <div class="space-y-1">
            <Label class="text-muted-foreground text-xs">
              Matching Browser User-Agent
            </Label>
            <Input
              v-model="booruCredentials.konachan.userAgent"
              :disabled="!booruAvailable"
              autocomplete="off"
              placeholder="Mozilla/5.0 ... Chrome/..."
              class="font-mono text-xs"
            />
          </div>
        </div>

        <p
          v-if="booruResult?.source === 'konachan.com'"
          class="text-xs font-medium"
          :class="booruResult.ok ? 'text-emerald-400' : 'text-destructive'"
        >
          {{ booruResult.message }}
        </p>
      </div>
    </div>
  </SettingsSection>
</template>
