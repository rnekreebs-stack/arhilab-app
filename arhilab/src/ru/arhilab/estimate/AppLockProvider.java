package ru.arhilab.estimate;

/** Optional local device lock, independent of account and server credentials. */
interface AppLockProvider {
    boolean isConfigured();
    void requestUnlock(Runnable onSuccess, Runnable onCancel);
}
