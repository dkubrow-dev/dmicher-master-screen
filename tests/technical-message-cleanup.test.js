import test from "node:test";
import assert from "node:assert/strict";
import {TechnicalMessageCleanup} from "../dmicher-master-screen/scripts/technical-message-cleanup.js";

test("native timer methods retain their global receiver on queue and dispose", () => {
  const originalSchedule = globalThis.setTimeout, originalCancel = globalThis.clearTimeout;
  const calls = [];
  globalThis.setTimeout = function (fn, delay) {
    assert.equal(this, globalThis, "Window.setTimeout rejects a cleanup-instance receiver");
    calls.push(["schedule", delay]); return 42;
  };
  globalThis.clearTimeout = function (id) {
    assert.equal(this, globalThis, "Window.clearTimeout rejects a cleanup-instance receiver");
    calls.push(["cancel", id]);
  };
  try {
    const cleanup = new TechnicalMessageCleanup({current:()=>true, now:()=>0});
    cleanup.queue({id:"receipt",delete:async()=>{}});
    cleanup.dispose();
    assert.deepEqual(calls, [["schedule",2000],["cancel",42]]);
  } finally {globalThis.setTimeout=originalSchedule;globalThis.clearTimeout=originalCancel;}
});

test("technical receipts share one released timer and each is deleted only by the current authority",async()=>{
  let clock=0,authority=true,next=0;const timers=new Map(),deleted=[];
  const cleanup=new TechnicalMessageCleanup({current:()=>authority,now:()=>clock,
    schedule:(fn,delay)=>{const id=++next;timers.set(id,{fn,delay});return id;},cancel:id=>timers.delete(id)});
  const message=id=>({id,delete:async()=>deleted.push(id)});
  cleanup.queue(message("a"));cleanup.queue(message("a"));cleanup.queue(message("b"));
  assert.equal(timers.size,1);assert.equal(cleanup.entries.size,2);
  const fire=()=>{const [id,timer]=timers.entries().next().value;timers.delete(id);clock+=timer.delay;timer.fn();};
  fire();await Promise.resolve();assert.deepEqual(deleted,["a","b"]);assert.equal(timers.size,0);
  cleanup.queue(message("c"));authority=false;fire();await Promise.resolve();assert.deepEqual(deleted,["a","b"]);
  cleanup.queue(message("d"));cleanup.dispose();assert.equal(timers.size,0);assert.equal(cleanup.entries.size,0);
});
