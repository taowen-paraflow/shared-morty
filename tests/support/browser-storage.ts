import "fake-indexeddb/auto";
import { beforeEach } from "vitest";

beforeEach(async () => {
    await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase("shared-morty-browser-v1");
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
});
