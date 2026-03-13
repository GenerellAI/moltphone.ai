'use client';
import { useState, useEffect, useRef } from 'react';

// Crockford Base32 alphabet (no I, L, O, U)
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const NATIONS = ['MPHO', 'MOLT', 'CLAW'];

// Pre-baked final numbers for each nation so the "hash" always lands the same
const FINAL_NUMBERS: Record<string, string[]> = {
  MPHO: ['7K3P', 'M2Q9', 'H8D6', '4R2E'],
  MOLT: ['Q5KW', '17VA', 'GKWV', 'NPW0'],
  CLAW: ['9V8W', '3X4Y', '5Z67', '8A9B'],
};

function randomChar() {
  return CROCKFORD[Math.floor(Math.random() * CROCKFORD.length)];
}

function randomNation() {
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return Array.from({ length: 4 }, () => alpha[Math.floor(Math.random() * 26)]).join('');
}

export default function MoltNumberSlot() {
  const [nation, setNation] = useState(NATIONS[0]);
  const [groups, setGroups] = useState(FINAL_NUMBERS[NATIONS[0]]);
  const rollingRef = useRef(false);
  const nationIndex = useRef(0);
  const tickInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    function rollSequence() {
      if (rollingRef.current) return;
      rollingRef.current = true;

      nationIndex.current = (nationIndex.current + 1) % NATIONS.length;
      const targetNation = NATIONS[nationIndex.current];
      const targetGroups = FINAL_NUMBERS[targetNation];

      let tick = 0;
      const NATION_TICKS = 8;
      const HASH_START = NATION_TICKS + 2;
      const GROUP_TICKS = 6;
      const TOTAL_TICKS = HASH_START + 4 * GROUP_TICKS + 4;

      tickInterval.current = setInterval(() => {
        tick++;

        if (tick <= NATION_TICKS) {
          setNation(randomNation());
          setGroups([
            Array.from({ length: 4 }, randomChar).join(''),
            Array.from({ length: 4 }, randomChar).join(''),
            Array.from({ length: 4 }, randomChar).join(''),
            Array.from({ length: 4 }, randomChar).join(''),
          ]);
        } else if (tick === NATION_TICKS + 1) {
          setNation(targetNation);
        } else if (tick >= HASH_START) {
          const hashTick = tick - HASH_START;
          const newGroups = [...targetGroups];

          for (let g = 0; g < 4; g++) {
            const groupStart = g * GROUP_TICKS;
            const groupEnd = groupStart + GROUP_TICKS;

            if (hashTick < groupStart) {
              newGroups[g] = Array.from({ length: 4 }, randomChar).join('');
            } else if (hashTick < groupEnd) {
              const locked = Math.floor(((hashTick - groupStart) / GROUP_TICKS) * 4);
              const chars = targetGroups[g].split('');
              for (let c = locked; c < 4; c++) {
                chars[c] = randomChar();
              }
              newGroups[g] = chars.join('');
            }
          }

          setGroups(newGroups);
        }

        if (tick >= TOTAL_TICKS) {
          setNation(targetNation);
          setGroups(targetGroups);
          clearInterval(tickInterval.current!);
          tickInterval.current = null;
          rollingRef.current = false;
        }
      }, 60);
    }

    const timer = setInterval(rollSequence, 6000);
    return () => {
      clearInterval(timer);
      if (tickInterval.current) clearInterval(tickInterval.current);
    };
  }, []);

  return (
    <div className="font-mono text-[1.05rem] sm:text-[1.55rem] font-bold tracking-[0.14em] text-center leading-tight select-none">
      <span className="text-primary inline-block min-w-[4ch] transition-all">{nation}</span>
      <span className="text-foreground/35">-</span>
      <span className="text-cyan-300 inline-block min-w-[4ch]">{groups[0]}</span>
      <span className="text-foreground/35">-</span>
      <span className="text-cyan-300 inline-block min-w-[4ch]">{groups[1]}</span>
      <span className="text-foreground/35">-</span>
      <span className="text-cyan-300 inline-block min-w-[4ch]">{groups[2]}</span>
      <span className="text-foreground/35">-</span>
      <span className="text-cyan-300 inline-block min-w-[4ch]">{groups[3]}</span>
    </div>
  );
}
