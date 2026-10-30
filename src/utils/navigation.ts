import type { Router } from 'vue-router';

export function returnTo(router: Router, path: string) {
  const previous = router.options.history.state.back;
  if (typeof previous === 'string' && previous.split('?')[0] === path)
    router.back();
  else void router.push(path);
}
