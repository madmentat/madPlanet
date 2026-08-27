'use strict';
const assert=require('assert');
const {generateRiverNetwork,D8}=require('../js/hydrology.js');

function mat(h,w,fn){ return Array.from({length:h},(_,y)=>Array.from({length:w},(_,x)=>fn(x,y))); }
function count(m,v=1){ return m.flat().filter(x=>x===v).length; }

assert.deepStrictEqual(D8.map(d=>d.name),['NE','E','SE','S','SW','W','NW','N']);

// 1. Простой склон: все сухопутные пути заканчиваются океаном, накопление растёт вниз.
{
  const H=mat(6,7,(x,y)=>y===5?-1:10-y);
  const O=mat(6,7,(x,y)=>y===5?1:0);
  const r=generateRiverNetwork({Heightmap:H,OceanMask:O,Threshold:2});
  assert(r.RiverGraph.length>0,'должна появиться речная сеть');
  assert(r.RiverTerminals.every(t=>t.type==='A'),'на простом склоне все реки должны выйти в океан');
  assert(r.Accum[4][3]>r.Accum[0][3],'Accum должен расти вниз по склону');
}

// 2. Депрессия заполняется Priority-Flood и не остаётся внезапным обрывом.
{
  const H=[
    [9,8,7,6,5,-1],
    [9,8,7,6,5,-1],
    [9,8,0,6,5,-1],
    [9,8,7,6,5,-1],
    [9,8,7,6,5,-1],
  ];
  const O=H.map(row=>row.map(v=>v<0?1:0));
  const r=generateRiverNetwork({Heightmap:H,OceanMask:O,Threshold:1});
  assert(r.CorrectedHeightmap[2][2]>0,'яма должна быть поднята');
  assert(r.RiverTerminals.every(t=>t.type!=='B'),'океан-связная яма после коррекции не должна обрывать реку');
}

// 3. Равный физический уклон NE и E: побеждает NE (первый по часовой стрелке).
{
  const H=mat(3,3,()=>20), O=mat(3,3,()=>0);
  H[1][1]=10;
  H[0][2]=10-Math.SQRT2; // slope = 1 по диагонали
  H[1][2]=9;             // slope = 1 по горизонтали
  // Делаем эти два соседа океаном, чтобы Priority-Flood не менял заданный tie.
  O[0][2]=1; O[1][2]=1; H[0][2]=-Math.SQRT2; H[1][2]=-1;
  H[1][1]=0;
  // Теперь slope к NE = sqrt(2)/sqrt(2)=1, к E = 1/1=1.
  const r=generateRiverNetwork({Heightmap:H,OceanMask:O,Threshold:999,Epsilon:1e-12});
  assert.strictEqual(r.FlowDir[1][1],0,'при равном уклоне должен быть выбран NE');
}

// 4. Без океана допустим глобальный минимум: он становится эндорейным озером.
{
  const H=[
    [8,7,6,7,8],
    [7,5,4,5,7],
    [6,4,1,4,6],
    [7,5,4,5,7],
    [8,7,6,7,8],
  ];
  const O=mat(5,5,()=>0);
  const r=generateRiverNetwork({Heightmap:H,OceanMask:O,Threshold:0});
  assert(r.RiverTerminals.some(t=>t.type==='B'),'должен существовать бессточный терминал');
  assert(count(r.LakeMask)>0,'в бессточном минимуме должна появиться LakeMask');
}

// 5. Арида: при накопленном потоке река может иссякнуть на суше только терминалом C.
{
  const H=mat(14,5,(x,y)=>20-y);
  const O=mat(14,5,()=>0); // глобальный минимум внизу, чтобы не было океана
  const R=mat(14,5,(x,y)=>y<8?1:0.02);
  const r=generateRiverNetwork({Heightmap:H,OceanMask:O,RainfallMap:R,Threshold:3});
  assert(r.RiverTerminals.some(t=>t.type==='C'),'река должна испариться в сухой зоне');
  assert(count(r.SaltFlatMask)>0,'терминал C должен создать солончаковую маску');
}

console.log('hydrology.test.js: OK');
