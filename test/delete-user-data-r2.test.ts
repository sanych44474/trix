// GDPR erasure used to leave progress photos in R2 forever: deleteUserData(db, userId) took no
// env, so it had no R2_PHOTOS binding and could only ever remove the DB rows that NAME an object,
// never the object itself. The existing delete-user-data-coverage guard test cannot catch this --
// it greps table names in SQL, and there is no table for "bytes in a bucket."
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { deleteUserData } from "../src/db/repos";
import { getOrCreateUser } from "../src/adapters/d1/v2Users";
import { addProgressPhoto, listProgressPhotos } from "../src/adapters/d1/v2Tracking";
import { r2Key } from "../src/webapp/photoStorage";
import type { Env } from "../src/types";

function fakeBucket(): { deletedKeys: string[]; bucket: Partial<R2Bucket> } {
  const deletedKeys: string[] = [];
  return {
    deletedKeys,
    bucket: {
      delete: (async (keys: string | string[]) => {
        deletedKeys.push(...(Array.isArray(keys) ? keys : [keys]));
      }) as R2Bucket["delete"],
    },
  };
}

function testEnv(db: ReturnType<typeof newDb>, bucket?: Partial<R2Bucket>): Env {
  return { DB: db, R2_PHOTOS: bucket as R2Bucket | undefined } as unknown as Env;
}

test("deleteUserData: removes the account's R2 progress-photo objects when R2_PHOTOS is configured", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  await addProgressPhoto(db, 1, "tg-file-1");
  await addProgressPhoto(db, 1, "tg-file-2");
  const [p1, p2] = await listProgressPhotos(db, 1);

  const { deletedKeys, bucket } = fakeBucket();
  await deleteUserData(testEnv(db, bucket), 1);

  assert.deepEqual(
    deletedKeys.sort(),
    [r2Key(p1.id), r2Key(p2.id)].sort(),
    "every photo row's R2 object must be addressed by exactly the key photoStorage.ts reads back",
  );
});

test("deleteUserData: only deletes THIS account's photo objects, not another user's", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  await getOrCreateUser(db, 2, 2, "en", "Bo");
  await addProgressPhoto(db, 1, "tg-file-ann");
  await addProgressPhoto(db, 2, "tg-file-bo");
  const [annPhoto] = await listProgressPhotos(db, 1);
  const [boPhoto] = await listProgressPhotos(db, 2);

  const { deletedKeys, bucket } = fakeBucket();
  await deleteUserData(testEnv(db, bucket), 1);

  assert.deepEqual(deletedKeys, [r2Key(annPhoto.id)]);
  assert.notEqual(deletedKeys[0], r2Key(boPhoto.id));
});

test("deleteUserData: no R2_PHOTOS binding -> no R2 call, DB deletion still proceeds", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  await addProgressPhoto(db, 1, "tg-file-1");

  // No throw despite there being nothing to delete from -- must behave like the R2 cache's own
  // "not configured" no-op path (photoStorage.ts), not like a missing dependency.
  await deleteUserData(testEnv(db, undefined), 1);

  assert.deepEqual(await listProgressPhotos(db, 1), []);
});

test("deleteUserData: an R2 failure does not block the rest of GDPR erasure", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  await addProgressPhoto(db, 1, "tg-file-1");

  const failingBucket: Partial<R2Bucket> = { delete: (async () => { throw new Error("r2 down"); }) as R2Bucket["delete"] };
  // Must not throw: an R2 outage is logged (delete_user_data_r2), not fatal to erasure.
  await deleteUserData(testEnv(db, failingBucket), 1);

  assert.deepEqual(await listProgressPhotos(db, 1), [], "the DB row must still be gone");
});
