import {
  DependencyList,
  EffectCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';

/**
 * Runs an effect when the explicitly declared lifecycle keys change while
 * always invoking the latest callback. This is intended for subscriptions and
 * data refreshes whose callback contains mutable implementation details that
 * must not become lifecycle triggers themselves.
 */
export const useLatestEffect = (
  effect: EffectCallback,
  dependencies: DependencyList,
) => {
  const effectRef = useRef(effect);
  useLayoutEffect(() => {
    effectRef.current = effect;
  });

  // The dependency list is deliberately owned by the caller's lifecycle
  // contract; the callback is read through a current ref.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => effectRef.current(), dependencies);
};

export const useLatestLayoutEffect = (
  effect: EffectCallback,
  dependencies: DependencyList,
) => {
  const effectRef = useRef(effect);
  useLayoutEffect(() => {
    effectRef.current = effect;
  });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => effectRef.current(), dependencies);
};
