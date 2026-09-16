import test from "node:test";
import assert from "node:assert/strict";
import {TechnicalMessageCleanup} from "../dmicher-master-screen/scripts/technical-message-cleanup.js";

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
