<script setup lang="ts">
import { ref } from 'vue';
import { Eye, EyeOff, KeyRound, Loader2, Wifi } from '@lucide/vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

defineProps<{
  title: string;
  subtitle?: string;
  configured: boolean;
  disabled: boolean;
  idPlaceholder: string;
  keyPlaceholder: string;
  testing: boolean;
  testDisabled: boolean;
  result?: { ok: boolean; message: string } | null;
}>();
const emit = defineEmits<{ test: [] }>();
const id = defineModel<string>('id', { required: true });
const secret = defineModel<string>('secret', { required: true });
const showSecret = ref(false);
</script>

<template>
  <div
    class="border-border/80 bg-muted/20 flex flex-col gap-3 rounded-lg border p-4 shadow-2xs"
  >
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <KeyRound class="text-primary h-4 w-4" />
        <div>
          <Label class="text-foreground text-xs font-semibold">
            {{ title }}
          </Label>
          <p v-if="subtitle" class="text-muted-foreground text-xs">
            {{ subtitle }}
          </p>
        </div>
      </div>
      <Badge
        variant="outline"
        :class="
          configured
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
            : 'border-border text-muted-foreground'
        "
        class="font-mono text-xs"
      >
        <span
          class="mr-1.5 h-1.5 w-1.5 rounded-full"
          :class="configured ? 'bg-emerald-400' : 'bg-muted-foreground'"
        />
        {{ configured ? 'Configured' : 'Not configured' }}
      </Badge>
    </div>

    <Input
      v-model="id"
      :disabled="disabled"
      autocomplete="off"
      :placeholder="idPlaceholder"
      class="font-mono text-xs"
    />

    <div class="relative">
      <Input
        v-model="secret"
        :disabled="disabled"
        :type="showSecret ? 'text' : 'password'"
        autocomplete="new-password"
        :placeholder="
          configured ? 'API Key (leave blank to keep current)' : keyPlaceholder
        "
        class="pr-9 font-mono text-xs"
      />
      <button
        type="button"
        class="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2 p-1"
        @click="showSecret = !showSecret"
      >
        <EyeOff v-if="showSecret" class="h-3.5 w-3.5" />
        <Eye v-else class="h-3.5 w-3.5" />
      </button>
    </div>

    <div class="flex items-center justify-between pt-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        :disabled="disabled || testDisabled"
        class="border-border bg-secondary text-xs font-medium"
        @click="emit('test')"
      >
        <Loader2 v-if="testing" class="h-3.5 w-3.5 animate-spin" />
        <Wifi v-else class="h-3.5 w-3.5" />
        <span>Test Account</span>
      </Button>

      <p
        v-if="result"
        class="text-xs font-medium"
        :class="result.ok ? 'text-emerald-400' : 'text-destructive'"
      >
        {{ result.message }}
      </p>
    </div>
  </div>
</template>
