package com.github.continuedev.continueintellijextension.utils;

import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import javax.swing.SwingUtilities;

public class ThreadUtil {
    private static final String WORKER_PREFIX = "worker";
    private static final AtomicInteger THREAD_COUNT = new AtomicInteger(1);
    private static final AtomicInteger INDEX_THREAD_COUNT = new AtomicInteger(1);
    private static final ThreadPoolExecutor EXECUTOR;
    private static final ThreadPoolExecutor INDEX_EXECUTOR;

    public static void execute(Runnable r) {
        EXECUTOR.execute(r);
    }

    public static void executeIndex(Runnable r) {
        INDEX_EXECUTOR.execute(r);
    }

    public static void sleep(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException var3) {
        }

    }

    public static void invokeLater(Runnable runnable) {
        EXECUTOR.execute(() -> {
            if (SwingUtilities.isEventDispatchThread()) {
                runnable.run();
            } else {
                SwingUtilities.invokeLater(runnable);
            }

        });
    }

    static {
        EXECUTOR = new ThreadPoolExecutor(Runtime.getRuntime().availableProcessors(), Runtime.getRuntime().availableProcessors() * 8, 60L, TimeUnit.SECONDS, new ArrayBlockingQueue(128), new ThreadFactory() {
            public Thread newThread(Runnable r) {
                return new Thread(r, "worker" + ThreadUtil.THREAD_COUNT.getAndIncrement());
            }
        }, new ThreadPoolExecutor.CallerRunsPolicy());
        INDEX_EXECUTOR = new ThreadPoolExecutor(2, 2, 0L, TimeUnit.MILLISECONDS, new LinkedBlockingQueue(), (r) -> new Thread(r, "index_thread" + INDEX_THREAD_COUNT.getAndIncrement()));
    }
}
