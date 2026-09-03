import { test } from "node:test";
import assert from "node:assert/strict";
import { pickBestVideo, parseYouTubeId, type YouTubeSearchItem } from "../src/youtube";

const item = (videoId: string, title: string, channelTitle: string): YouTubeSearchItem => ({
  id: { videoId },
  snippet: { title, channelTitle, thumbnails: { medium: { url: `https://i.ytimg.com/${videoId}.jpg` } } },
});

test("pickBestVideo: preferred channel outranks a generic upload", () => {
  const best = pickBestVideo(
    [
      item("aaa11111111", "Bench Press tips", "Random Fitness Guy"),
      item("bbb22222222", "The PERFECT Bench Press", "Gym Visual"),
    ],
    "Barbell Bench Press",
  );
  assert.equal(best?.videoId, "bbb22222222");
  assert.equal(best?.url, "https://www.youtube.com/shorts/bbb22222222");
});

test("pickBestVideo: a title matching the exercise beats an unrelated one", () => {
  const best = pickBestVideo(
    [
      item("ccc33333333", "How to do a Romanian Deadlift", "Some Coach"),
      item("ddd44444444", "Bicep curl form", "Some Coach"),
    ],
    "Romanian Deadlift",
  );
  assert.equal(best?.videoId, "ccc33333333");
});

test("pickBestVideo: blocklisted titles are rejected", () => {
  const best = pickBestVideo(
    [
      item("eee55555555", "Top 10 chest exercises compilation", "Gym Visual"),
      item("fff66666666", "Best motivation workout vlog", "Gym Visual"),
    ],
    "Chest Fly",
  );
  assert.equal(best, null);
});

test("pickBestVideo: no relevance signal returns null", () => {
  const best = pickBestVideo([item("ggg77777777", "My morning routine", "Lifestyle Channel")], "Lateral Raise");
  assert.equal(best, null);
  assert.equal(pickBestVideo([], "Squat"), null);
});

test("parseYouTubeId: watch / shorts / youtu.be forms", () => {
  assert.equal(parseYouTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(parseYouTubeId("https://youtube.com/shorts/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(parseYouTubeId("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(parseYouTubeId("https://www.youtube.com/watch?list=PL123&v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(parseYouTubeId("not a url"), null);
});
