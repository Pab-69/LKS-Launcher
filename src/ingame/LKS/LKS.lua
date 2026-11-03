-- LKS : appli en jeu pour le Custom Shaders Patch.
-- Angle, clips et écart en direct ; runs de la porte de départ à l'arrivée ;
-- feux de départ ; fantôme à suivre (choisi ici ou dans le launcher) ;
-- battles lancées en jeu (défi, feux synchronisés, runs inversées) ;
-- position des autres pilotes pour la télémétrie du launcher.
-- La note complète est calculée par le launcher.

local atan2 = math.atan2 or math.atan -- LuaJIT (CSP) a math.atan2

local GREEN = rgbm(0.25, 0.85, 0.5, 1)
local RED = rgbm(0.88, 0.11, 0.23, 1)
local AMBER = rgbm(1, 0.62, 0.1, 1)
local GREY = rgbm(0.66, 0.61, 0.58, 1)
local WHITE = rgbm(1, 1, 1, 1)
local DARK = rgbm(0.18, 0.16, 0.16, 1)

local function safe(fn, default)
  local ok, v = pcall(fn)
  if ok and v ~= nil then return v end
  return default
end

local function num(v) return string.format('%.2f', tonumber(v) or 0) end
local function jstr(v) return '"' .. tostring(v or ''):gsub('[%c"\\]', ' ') .. '"' end

local function appDir()
  local okDir, dir = pcall(function() return __dirname end)
  return (okDir and dir) or '.'
end

local function writeFile(rel, text)
  return pcall(function()
    local f = io.open(appDir() .. '/' .. rel, 'w')
    f:write(text)
    f:close()
  end)
end

local function readFile(rel)
  local raw = safe(function() return io.load(appDir() .. '/' .. rel) end, nil)
  if raw == nil then
    raw = safe(function()
      local f = io.open(appDir() .. '/' .. rel, 'r')
      if not f then return nil end
      local s = f:read('*a')
      f:close()
      return s
    end, nil)
  end
  return raw
end

local function parseJson(raw)
  if not raw or raw == '' then return nil end
  local ok, v = pcall(function() return JSON.parse(raw) end)
  if ok and type(v) == 'table' then return v end
  return nil
end

local function stamp()
  return tostring(safe(function() return os.time() end, math.random(1, 1e9))) .. '-' .. tostring(math.random(1000, 9999))
end

local clock = 0 -- ms, avance avec le jeu
local trackId = safe(function() return ac.getTrackID() end, '')
local layoutId = safe(function() return ac.getTrackLayout() end, '') or ''
local note = { text = nil, untilT = 0 }
local function say(text, ms) note.text, note.untilT = text, clock + (ms or 4000) end

-- ------------------------------------------------------------- parcours
-- Écrit par le launcher : clips, et pour les runs : portes de départ et
-- d'arrivée, ligne du parcours, place de départ.
local course = {}
do
  local okFile, courses = pcall(dofile, appDir() .. '/courses.lua')
  if okFile and type(courses) == 'table' then course = courses[trackId .. '|' .. layoutId] or {} end
end
local clips = course.clips or {}
local gated = course.start ~= nil and course.finish ~= nil and course.line ~= nil and #course.line > 1

-- position le long de la ligne du parcours (0 au départ, 1 à l'arrivée)
local line = course.line or {}
local cum = { 0 }
for i = 2, #line do
  cum[i] = cum[i - 1] + math.sqrt((line[i][1] - line[i - 1][1]) ^ 2 + (line[i][2] - line[i - 1][2]) ^ 2)
end
local lineTotal = cum[#cum] or 1
if lineTotal <= 0 then lineTotal = 1 end

local function onSegment(i, x, z)
  local ax, az, bx, bz = line[i][1], line[i][2], line[i + 1][1], line[i + 1][2]
  local vx, vz = bx - ax, bz - az
  local len2 = vx * vx + vz * vz
  if len2 <= 0 then len2 = 1 end
  local k = math.max(0, math.min(1, ((x - ax) * vx + (z - az) * vz) / len2))
  local px, pz = ax + vx * k, az + vz * k
  return (cum[i] + k * math.sqrt(len2)) / lineTotal, math.sqrt((x - px) ^ 2 + (z - pz) ^ 2), i
end

-- hint : table propre à chaque voiture pour chercher près de la dernière réponse
local function locate(x, z, hint)
  if #line < 2 then return 0, 0 end
  local bestD, bestDist, bestI = 0, math.huge, 1
  local function scan(a, b)
    for i = math.max(1, a), math.min(#line - 1, b) do
      local d, dist, idx = onSegment(i, x, z)
      if dist < bestDist then bestD, bestDist, bestI = d, dist, idx end
    end
  end
  if hint and hint.i then scan(hint.i - 8, hint.i + 12) end
  if bestDist > 15 then scan(1, #line - 1) end
  if hint then hint.i = bestI end
  return bestD, bestDist
end

local function lineDir(d)
  if #line < 2 then return 0, 1 end
  local target, i = d * lineTotal, 2
  while i < #line and cum[i] < target do i = i + 1 end
  local dx, dz = line[i][1] - line[i - 1][1], line[i][2] - line[i - 1][2]
  local l = math.sqrt(dx * dx + dz * dz)
  if l <= 0 then return 0, 1 end
  return dx / l, dz / l
end

-- le déplacement a→b traverse-t-il la porte (allongée de 2 m de chaque côté) ?
local function crosses(gate, ax, az, bx, bz)
  if not gate then return false end
  local cx, cz, dx, dz = gate[1][1], gate[1][2], gate[2][1], gate[2][2]
  local gl = math.sqrt((dx - cx) ^ 2 + (dz - cz) ^ 2)
  if gl <= 0 then return false end
  local ex, ez = (dx - cx) / gl * 2, (dz - cz) / gl * 2
  cx, cz, dx, dz = cx - ex, cz - ez, dx + ex, dz + ez
  local function cr(ux, uz, vx, vz) return ux * vz - uz * vx end
  local d1 = cr(dx - cx, dz - cz, ax - cx, az - cz)
  local d2 = cr(dx - cx, dz - cz, bx - cx, bz - cz)
  local d3 = cr(bx - ax, bz - az, cx - ax, cz - az)
  local d4 = cr(bx - ax, bz - az, dx - ax, dz - az)
  return d1 * d2 < 0 and d3 * d4 < 0
end

local function crossesForward(gate, d, ax, az, bx, bz)
  if not crosses(gate, ax, az, bx, bz) then return false end
  local fx, fz = lineDir(d)
  return (bx - ax) * fx + (bz - az) * fz > 0
end

local function segDist(g, x, z)
  local ax, az, bx, bz = g[1][1], g[1][2], g[2][1], g[2][2]
  local vx, vz = bx - ax, bz - az
  local l2 = vx * vx + vz * vz
  if l2 <= 0 then l2 = 1 end
  local k = math.max(0, math.min(1, ((x - ax) * vx + (z - az) * vz) / l2))
  return math.sqrt((x - ax - vx * k) ^ 2 + (z - az - vz * k) ^ 2)
end

-- Deux lignes au départ : la « ligne de start » où l'on s'arrête pour les feux,
-- et la « ligne de départ » où la run et la note commencent.
local staging = course.staging

-- bien placé pour les feux ?
local function behindStart(x, z)
  if not gated then return true end
  if staging then return segDist(staging, x, z) < 15 end
  local mx, mz = (course.start[1][1] + course.start[2][1]) / 2, (course.start[1][2] + course.start[2][2]) / 2
  local fx, fz = lineDir(0)
  local dist = math.sqrt((x - mx) ^ 2 + (z - mz) ^ 2)
  return (x - mx) * fx + (z - mz) * fz < 0.5 and dist < 250
end

-- ------------------------------------------------------------- angle, clips
local function slipAngle(car)
  if car.speedKmh < 10 then return 0 end
  local v = car.localVelocity
  return math.deg(atan2(v.x, v.z))
end

local function driftAngle(car)
  local a = math.abs(slipAngle(car))
  if a > 90 then a = 180 - a end
  return a
end

local clipState, lastClip = {}, nil
local show3d = true

local function pathLength(path)
  local len = 0
  for i = 2, #path do len = len + math.sqrt((path[i][1] - path[i - 1][1]) ^ 2 + (path[i][2] - path[i - 1][2]) ^ 2) end
  return len
end

local function resetClips()
  clipState = {}
  for i = 1, #clips do
    local c = clips[i]
    local st = { hit = false, best = nil, gap = nil }
    if c.path and #c.path > 1 then
      st.slices, st.n, st.covered = {}, math.max(1, math.ceil(pathLength(c.path))), 0
    end
    clipState[i] = st
  end
  lastClip = nil
end
resetClips()

-- distance au clip : à son centre, ou à sa bande pour une zone longue peinte au sol
local function clipDist(c, x, z)
  local path = c.path
  if not path or #path < 2 then return math.sqrt((x - c.x) ^ 2 + (z - c.z) ^ 2) end
  local best = math.huge
  for i = 1, #path - 1 do
    local ax, az, bx, bz = path[i][1], path[i][2], path[i + 1][1], path[i + 1][2]
    local vx, vz = bx - ax, bz - az
    local l2 = vx * vx + vz * vz
    if l2 <= 0 then l2 = 1 end
    local k = math.max(0, math.min(1, ((x - ax) * vx + (z - az) * vz) / l2))
    local d = math.sqrt((x - ax - vx * k) ^ 2 + (z - az - vz * k) ^ 2)
    if d < best then best = d end
  end
  return best
end

-- position le long d'une zone (m depuis son début) et distance à elle
local function alongPath(path, x, z)
  local bestD, bestAt, acc = math.huge, 0, 0
  for i = 1, #path - 1 do
    local ax, az, bx, bz = path[i][1], path[i][2], path[i + 1][1], path[i + 1][2]
    local vx, vz = bx - ax, bz - az
    local len = math.sqrt(vx * vx + vz * vz)
    if len <= 0 then len = 1e-6 end
    local k = math.max(0, math.min(1, ((x - ax) * vx + (z - az) * vz) / (len * len)))
    local d = math.sqrt((x - ax - vx * k) ^ 2 + (z - az - vz * k) ^ 2)
    if d < bestD then bestD, bestAt = d, acc + k * len end
    acc = acc + len
  end
  return bestD, bestAt
end

-- point jugé : l'avant de la voiture pour une corde, l'arrière pour une zone extérieure
local HALF_LENGTH = 2.0
local function judgedPoint(c, car)
  local p, l = car.position, car.look
  local k = (c.kind == 'outer') and -HALF_LENGTH or HALF_LENGTH
  local ll = math.sqrt(l.x * l.x + l.z * l.z)
  if ll <= 0 then return p.x, p.z end
  return p.x + l.x / ll * k, p.z + l.z / ll * k
end

local ZONE_HIT = 0.2 -- part d'une zone longue à couvrir pour qu'elle compte

local function updateClips(car, angle, gap)
  local drifting = angle >= 12 and car.speedKmh >= 25
  for i, c in ipairs(clips) do
    local x, z = judgedPoint(c, car)
    local st = clipState[i]
    if st.slices then
      local dist, at = alongPath(c.path, x, z)
      if dist < c.r * 4 then
        if st.best == nil or dist < st.best then st.best = dist end
        if dist <= c.r and drifting then
          local k = math.min(st.n, math.floor(at) + 1)
          if not st.slices[k] then
            st.slices[k] = true
            st.covered = st.covered + 1
          end
          if st.gap == nil and gap then st.gap = gap end
          local cover = st.covered / st.n
          if not st.hit and cover >= ZONE_HIT then st.hit = true end
          if st.hit then lastClip = string.format('%s ✓ %d %%', c.name, math.floor(cover * 100 + 0.5)) end
        end
      end
    else
      local dist = math.sqrt((x - c.x) ^ 2 + (z - c.z) ^ 2)
      if dist < c.r * 4 then
        if st.best == nil or dist < st.best then st.best = dist end
        if not st.hit and dist <= c.r and drifting then
          st.hit = true
          st.gap = gap
          lastClip = string.format('%s ✓ %.1f m', c.name, dist)
        end
      end
    end
  end
end

-- ------------------------------------------------------------- run
-- Parcours avec portes : une run va de la porte de départ à l'arrivée.
-- Sinon : une run = un tour (ligne à ligne).
local run = { active = false, t0 = 0, d = 0, hint = {}, best = nil, bestMs = nil, current = {}, lastMs = nil, lights = false }
local BUCKETS = 1000
local lastLapCount = -1
local prevPos = nil

local function runMs(car)
  if gated then return clock - run.t0 end
  return car.lapTimeMs
end

-- ------------------------------------------------------------- tandem / battle
local tandem = { other = nil, role = nil, rows = {}, frames = 0, withFrames = 0, lastT = -1, lastD = -1, saved = nil, lost = 0, hintC = {}, hintL = {}, closing = nil, otherPrev = nil, otherDone = false }
local battle = nil -- { tag, sid, idx, name, mine (défi lancé par moi), run, phase, meReady, otherReady, sentAt, lightsSent }
local invites = {}
local result = nil

-- voiture la plus proche (moins de 35 m), devant ou derrière
local function findPartner(me)
  local count = safe(function() return ac.getSim().carsCount end, 1)
  local best, bestDist, bestRole = nil, 35, nil
  for i = 1, count - 1 do
    local c = ac.getCar(i)
    if c and safe(function() return c.isConnected end, true) and c.speedKmh > 10 then
      local dx, dz = c.position.x - me.position.x, c.position.z - me.position.z
      local dist = math.sqrt(dx * dx + dz * dz)
      if dist < bestDist then
        best, bestDist = i, dist
        bestRole = (dx * me.look.x + dz * me.look.z > 0) and 'chase' or 'lead'
      end
    end
  end
  return best, bestRole
end

local function battleRole()
  if not battle then return nil end
  if (battle.run == 1) == battle.mine then return 'lead' end
  return 'chase'
end

local function resetTandem()
  tandem.other, tandem.role, tandem.rows, tandem.frames, tandem.withFrames, tandem.lastT, tandem.lastD, tandem.lost = nil, nil, {}, 0, 0, -1, -1, 0
  tandem.hintC, tandem.hintL, tandem.closing, tandem.otherPrev, tandem.otherDone = {}, {}, nil, nil, false
  tandem.gapSum, tandem.gapN = 0, 0
end

local function saveRun(lapMs)
  local rows = tandem.rows
  if tandem.other == nil or #rows < 40 or tandem.withFrames < tandem.frames * 0.5 then return false end
  local other = tandem.other
  local chaser, leader = 0, other
  if tandem.role == 'lead' then chaser, leader = other, 0 end
  local out = {}
  for i = 1, #rows do out[i] = '[' .. table.concat(rows[i], ',') .. ']' end
  local tag = ''
  if battle and tandem.battle then tag = ',"battle":' .. jstr(tandem.battle.tag) .. ',"run":' .. tostring(tandem.battle.run) end
  local json = '{"v":1,"role":' .. jstr(tandem.role) ..
    ',"track":' .. jstr(trackId) .. ',"layout":' .. jstr(layoutId) ..
    ',"car":' .. jstr(safe(function() return ac.getCarID(chaser) end, '')) ..
    ',"driver":' .. jstr(safe(function() return ac.getDriverName(chaser) end, '')) ..
    ',"lead":{"name":' .. jstr(safe(function() return ac.getDriverName(leader) end, '')) .. ',"car":' .. jstr(safe(function() return ac.getCarID(leader) end, '')) .. '}' ..
    ',"recordedBy":' .. jstr(safe(function() return ac.getDriverName(0) end, '')) ..
    ',"time":' .. tostring(safe(function() return os.time() end, 0)) ..
    ',"lapMs":' .. tostring(math.floor(lapMs or 0)) .. tag ..
    ',"rows":[' .. table.concat(out, ',') .. ']}'
  local ok = writeFile('runs/' .. stamp() .. '.json', json)
  local name = safe(function() return ac.getDriverName(other) end, '?')
  if not ok then tandem.saved = 'Tandem : enregistrement impossible'
  elseif tandem.role == 'lead' then tandem.saved = 'Run enregistrée devant ' .. name
  else tandem.saved = 'Tandem enregistré derrière ' .. name end
  return ok
end

local function updateTandem(me, t)
  tandem.frames = tandem.frames + 1
  if tandem.other == nil then
    if battle and battle.phase == 'running' and battle.idx then
      tandem.other, tandem.role = battle.idx, battleRole()
      tandem.battle = { tag = battle.tag, run = battle.run }
    else
      tandem.other, tandem.role = findPartner(me)
      tandem.battle = nil
    end
  end
  if tandem.other == nil then return nil end
  local o = ac.getCar(tandem.other)
  if not o then resetTandem() return nil end
  local dx, dz = o.position.x - me.position.x, o.position.z - me.position.z
  local gap = math.sqrt(dx * dx + dz * dz)
  if gap > 80 then
    tandem.lost = tandem.lost + 1
    if tandem.lost > 300 and not tandem.battle then resetTandem() end
    return nil
  end
  tandem.lost = 0
  tandem.withFrames = tandem.withFrames + 1
  tandem.gapSum, tandem.gapN = (tandem.gapSum or 0) + gap, (tandem.gapN or 0) + 1
  local c, l = me, o -- chaser, leader
  if tandem.role == 'lead' then c, l = o, me end
  local d
  if gated then d = locate(c.position.x, c.position.z, tandem.hintC)
  else d = safe(function() return c.splinePosition end, me.splinePosition) end
  if t - tandem.lastT >= 50 and d > tandem.lastD then
    tandem.lastT, tandem.lastD = t, d
    local cw = safe(function() return me.collidedWith end, -1)
    local contact = (cw == tandem.other) and 1 or 0
    local rows = tandem.rows
    if #rows < 20000 then
      rows[#rows + 1] = { tostring(math.floor(t)), string.format('%.5f', d), num(c.position.x), num(c.position.z), num(c.speedKmh), num(slipAngle(c)),
        num(safe(function() return c.gas end, 0)), num(safe(function() return c.brake end, 0)), tostring(safe(function() return c.gear end, 0) + 1), tostring(safe(function() return c.wheelsOutside end, 0)),
        num(l.position.x), num(l.position.z), num(slipAngle(l)), num(l.speedKmh), tostring(contact),
        string.format('%.4f', c.look.x), string.format('%.4f', c.look.z) }
    end
  end
  return gap
end

-- ------------------------------------------------------------- fantôme
-- Enregistrement : chaque run complète est écrite dans ghosts/ (position et
-- orientation 20 fois par seconde, avec les secondes d'avant le départ).
-- Lecture : ghost.json (choisi dans le launcher) ou un fantôme de library/.
local rec = { rows = {}, lastT = -1, pre = {} }
local ghost = { data = nil, t = 0, running = false, lead = 0, wait = true, visible = true, gap = nil, note = nil, source = 'launcher', id = nil }
local library = { items = {}, checkedAt = -1e9 }
local panel = nil

local function ghostRow(car, t)
  local p, l, u = car.position, car.look, car.up
  return { t, p.x, p.y, p.z, l.x, l.y, l.z, u.x, u.y, u.z, car.speedKmh }
end

local function recordGhost(car)
  if gated and not run.active then
    -- secondes d'avant le départ (pour rejouer un départ arrêté)
    local pre = rec.pre
    if #pre == 0 or clock - pre[#pre][1] >= 50 then
      pre[#pre + 1] = ghostRow(car, clock)
      while #pre > 0 and clock - pre[1][1] > 20000 do table.remove(pre, 1) end
    end
    return
  end
  local t = gated and clock or car.lapTimeMs
  if t - rec.lastT < 50 or #rec.rows >= 20000 then return end
  rec.lastT = t
  rec.rows[#rec.rows + 1] = ghostRow(car, t)
end

local function saveGhost(lapMs, offset, green)
  local rows = rec.rows
  if (lapMs or 0) <= 0 or #rows < 40 then return end
  local out = {}
  for i = 1, #rows do
    local r = rows[i]
    out[i] = table.concat({ tostring(math.floor(r[1] - offset)), num(r[2]), num(r[3]), num(r[4]),
      string.format('%.4f', r[5]), string.format('%.4f', r[6]), string.format('%.4f', r[7]),
      string.format('%.4f', r[8]), string.format('%.4f', r[9]), string.format('%.4f', r[10]), num(r[11]) }, ',')
  end
  local json = '{"v":1,"track":' .. jstr(trackId) .. ',"layout":' .. jstr(layoutId) ..
    ',"car":' .. jstr(safe(function() return ac.getCarID(0) end, '')) ..
    ',"driver":' .. jstr(safe(function() return ac.getDriverName(0) end, '')) ..
    ',"time":' .. tostring(safe(function() return os.time() end, 0)) ..
    ',"lapMs":' .. tostring(math.floor(lapMs)) ..
    (green and (',"green":' .. tostring(math.floor(green))) or '') ..
    ',"rows":[[' .. table.concat(out, '],[') .. ']]}'
  writeFile('ghosts/' .. stamp() .. '.json', json)
end

local function useGhost(g, source, id)
  if type(g) ~= 'table' or type(g.rows) ~= 'table' or #g.rows < 10 then return false end
  if g.track ~= trackId or (g.layout or '') ~= layoutId then
    ghost.note = 'Fantôme prévu pour un autre circuit'
    return false
  end
  ghost.data, ghost.source, ghost.id, ghost.note, ghost.running = g, source, id, nil, false
  return true
end

local function loadGhost()
  if ghost.source ~= 'launcher' then return end
  ghost.data = nil
  useGhost(parseJson(readFile('ghost.json')), 'launcher', nil)
end

local function loadLibrary()
  library.checkedAt = clock
  local idx = parseJson(readFile('library/index.json'))
  local items = {}
  if idx and type(idx.items) == 'table' then
    for _, it in ipairs(idx.items) do
      if type(it) == 'table' and it.track == trackId and (it.layout or '') == layoutId and type(it.file) == 'string' and it.file:match('^[%w_%-]+%.json$') then
        items[#items + 1] = it
      end
    end
  end
  library.items = items
end

local function pickGhost(item)
  if item == nil then
    ghost.data, ghost.source, ghost.id, ghost.running = nil, 'none', nil, false
    return
  end
  if item == 'launcher' then
    ghost.source = 'launcher'
    loadGhost()
    return
  end
  if useGhost(parseJson(readFile('library/' .. item.file)), 'library', item.file) then say('Fantôme : ' .. tostring(item.driver or '?'))
  else say('Fantôme illisible') end
end

local function ghostAt(t)
  local rows = ghost.data.rows
  local n = #rows
  if t <= rows[1][1] then return rows[1], rows[1], 0 end
  if t >= rows[n][1] then return rows[n], rows[n], 0 end
  local lo, hi = 1, n
  while hi - lo > 1 do
    local mid = math.floor((lo + hi) / 2)
    if rows[mid][1] <= t then lo = mid else hi = mid end
  end
  local a, b = rows[lo], rows[hi]
  local k = (b[1] == a[1]) and 0 or (t - a[1]) / (b[1] - a[1])
  return a, b, k
end

local function startGhost(t)
  if not ghost.data then return end
  ghost.t, ghost.running = t, true
end

local gPos, gLook, gUp = vec3(), vec3(), vec3()
local function updateGhost(car, dt)
  if not ghost.data or not ghost.running then return end
  local rows = ghost.data.rows
  local a, b, k = ghostAt(ghost.t)
  local function lerp(i) return a[i] + (b[i] - a[i]) * k end
  gPos:set(lerp(2), lerp(3), lerp(4))
  gLook:set(lerp(5), lerp(6), lerp(7))
  gLook:normalize()
  gUp:set(lerp(8), lerp(9), lerp(10))
  gUp:normalize()
  local dx, dz = gPos.x - car.position.x, gPos.z - car.position.z
  ghost.gap = math.sqrt(dx * dx + dz * dz)
  -- « attente » : le fantôme ralentit quand tu es loin derrière
  local rate = 1
  if ghost.wait and ghost.gap > 20 and ghost.t > 0 then rate = math.max(0.35, 1 - (ghost.gap - 20) / 40) end
  ghost.t = ghost.t + dt * 1000 * rate
  if ghost.t > rows[#rows][1] + 2000 then ghost.running = false end
end

-- ------------------------------------------------------------- feux de départ
-- 3 feux rouges qui s'allument, puis vert. Bouger avant le vert = faux départ.
local lights = { state = 'off', at = 0, lit = 0, greenAt = nil, pos = nil, onGreen = nil }
local LIGHT_MS = 800

local function startLights(car, onGreen)
  lights.state, lights.at, lights.lit, lights.pos, lights.onGreen = 'count', clock, 0, vec3(car.position.x, car.position.y, car.position.z), onGreen
end

local function canStage(car)
  if car.speedKmh > 3 then return false, 'Arrête-toi d’abord' end
  if gated and not behindStart(car.position.x, car.position.z) then return false, staging and 'Place-toi sur la ligne de start' or 'Place-toi avant la ligne de départ' end
  return true
end

local function updateLights(car)
  if lights.state == 'count' then
    local e = clock - lights.at
    lights.lit = math.min(3, math.floor(e / LIGHT_MS))
    local moved = math.sqrt((car.position.x - lights.pos.x) ^ 2 + (car.position.z - lights.pos.z) ^ 2)
    if moved > 1.5 then
      lights.state = 'false'
      lights.at = clock
      say('Faux départ !', 3000)
      return
    end
    if e >= LIGHT_MS * 4 then
      lights.state, lights.greenAt, lights.at = 'green', clock, clock
      if lights.onGreen then lights.onGreen() end
    end
  elseif (lights.state == 'green' or lights.state == 'false') and clock - lights.at > 2500 then
    lights.state = 'off'
  end
end

-- ------------------------------------------------------------- battle en ligne
local online = safe(function() return ac.getSim().isOnlineRace end, false)
local mySid = function() return safe(function() return ac.getCar(0).sessionID end, -1) end
local battleEvent = nil
local KIND = { challenge = 1, accept = 2, cancel = 3, ready = 4, lights = 5, done = 6 }

local function send(kind, to, tag, runN)
  if not battleEvent then return false end
  return safe(function() return battleEvent({ kind = kind, to = to, tag = tag, run = runN or 0, mode = 0 }) end, false)
end

local function carBySid(sid)
  local count = safe(function() return ac.getSim().carsCount end, 1)
  for i = 1, count - 1 do
    local c = ac.getCar(i)
    if c and safe(function() return c.sessionID end, -2) == sid then return i, c end
  end
  return nil
end

local function battleLights()
  local car = ac.getCar(0)
  if not car or not battle then return end
  battle.phase = 'lights'
  startLights(car, function()
    if battle then battle.phase = 'running' end
    if ghost.data and ghost.data.green then startGhost(ghost.data.green) end
  end)
end

local function stageRun(n)
  battle.run, battle.phase, battle.meReady, battle.otherReady, battle.sentAt, battle.lightsSent = n, 'staging', false, false, -1e9, false
  battle.meDone, battle.otherDone = false, false
  say(string.format('Battle run %d : tu es %s', n, battleRole() == 'lead' and 'devant (lead)' or 'derrière (chase)'), 6000)
end

local function onMessage(sender, data)
  if not data then return end
  local fromMe = sender ~= nil and sender.index == 0
  local fromSid = sender and safe(function() return sender.sessionID end, -1) or -1
  if fromMe or data.to ~= mySid() then return end -- mes propres messages sont traités à l'envoi
  local kind, tag = data.kind, data.tag
  if kind == KIND.challenge then
    local idx = carBySid(fromSid)
    invites[#invites + 1] = { sid = fromSid, idx = idx, tag = tag, name = idx and safe(function() return ac.getDriverName(idx) end, '?') or '?', at = clock }
    say((invites[#invites].name or '?') .. ' te défie en battle !', 8000)
  elseif not battle or battle.tag ~= tag then
    return
  elseif kind == KIND.accept and battle.mine and battle.phase == 'invited' then
    stageRun(1)
  elseif kind == KIND.cancel then
    say('Battle annulée par ' .. tostring(battle.name), 5000)
    battle = nil
  elseif kind == KIND.ready and data.run == battle.run then
    battle.otherReady = true
  elseif kind == KIND.lights and data.run == battle.run and battle.phase == 'staging' then
    battleLights()
  elseif kind == KIND.done and data.run == battle.run then
    battle.otherDone = true
  end
end

if online then
  battleEvent = safe(function()
    return ac.OnlineEvent({
      ac.StructItem.key('lksBattle2'),
      kind = ac.StructItem.byte(),
      to = ac.StructItem.int16(),
      tag = ac.StructItem.int32(),
      run = ac.StructItem.byte(),
      mode = ac.StructItem.byte(),
    }, onMessage)
  end, nil)
end

local function challenge(idx)
  local sid = safe(function() return ac.getCar(idx).sessionID end, -1)
  local tag = math.random(100000, 2000000000)
  battle = { tag = tag, sid = sid, idx = idx, name = safe(function() return ac.getDriverName(idx) end, '?'), mine = true, run = 1, phase = 'invited', at = clock }
  if not send(KIND.challenge, sid, tag) then say('Message non envoyé, réessaie dans une seconde') end
end

local function acceptInvite(inv)
  battle = { tag = inv.tag, sid = inv.sid, idx = inv.idx, name = inv.name, mine = false, run = 1, phase = 'invited', at = clock }
  send(KIND.accept, inv.sid, inv.tag)
  invites = {}
  stageRun(1)
end

local function cancelBattle()
  if battle then send(KIND.cancel, battle.sid, battle.tag) end
  battle = nil
end

local function updateBattle(car)
  if not battle then return end
  if battle.idx == nil or not ac.getCar(battle.idx) then
    battle.idx = carBySid(battle.sid)
    if battle.idx == nil and clock - battle.at > 5000 then
      say('Battle annulée : ' .. tostring(battle.name) .. ' n’est plus là', 5000)
      battle = nil
      return
    end
  end
  if battle.phase == 'invited' and battle.mine and clock - battle.at > 30000 then
    say('Pas de réponse au défi', 4000)
    battle = nil
    return
  end
  if battle.phase == 'staging' then
    local ok = canStage(car)
    battle.meReady = ok
    if ok and clock - battle.sentAt > 3000 then
      send(KIND.ready, battle.sid, battle.tag, battle.run)
      battle.sentAt = clock
    end
    -- le leader donne le départ quand les deux sont prêts
    if battleRole() == 'lead' and battle.meReady and battle.otherReady and not battle.lightsSent then
      battle.lightsSent = true
      send(KIND.lights, battle.sid, battle.tag, battle.run)
      battleLights()
    end
  end
end

-- fin d'une run de battle (la mienne et celle de l'autre sont finies)
local function battleRunOver()
  if not battle then return end
  send(KIND.done, battle.sid, battle.tag, battle.run)
  if battle.run == 1 then
    stageRun(2)
  else
    battle.phase = 'done'
    battle.doneAt = clock
    say('Battle finie : le launcher calcule le résultat', 6000)
  end
end

-- résultat écrit par le launcher
local function checkResult()
  if not battle or battle.phase ~= 'done' then return end
  local r = parseJson(readFile('result.json'))
  if r and tostring(r.tag) == tostring(battle.tag) and r.text then
    result = { text = tostring(r.text), at = clock }
    battle = nil
  elseif clock - battle.doneAt > 120000 then
    battle = nil
  end
end

-- ------------------------------------------------------------- autres pilotes (pour le launcher)
local liveAt = -1e9
local function writeLive(me)
  if clock - liveAt < 250 then return end
  liveAt = clock
  local count = safe(function() return ac.getSim().carsCount end, 1)
  local cars = {}
  for i = 0, count - 1 do
    local c = ac.getCar(i)
    if c and (i == 0 or safe(function() return c.isConnected end, true)) then
      local d = gated and locate(c.position.x, c.position.z, nil) or safe(function() return c.splinePosition end, 0)
      cars[#cars + 1] = '{"i":' .. i .. ',"n":' .. jstr(safe(function() return ac.getDriverName(i) end, '')) .. ',"c":' .. jstr(safe(function() return ac.getCarID(i) end, '')) ..
        ',"x":' .. num(c.position.x) .. ',"z":' .. num(c.position.z) .. ',"s":' .. num(c.speedKmh) .. ',"a":' .. num(driftAngle(c)) .. ',"d":' .. string.format('%.4f', d) .. '}'
    end
  end
  local b = 'null'
  if battle then b = '{"name":' .. jstr(battle.name) .. ',"run":' .. battle.run .. ',"phase":' .. jstr(battle.phase) .. ',"role":' .. jstr(battleRole()) .. '}' end
  writeFile('live.json', '{"v":1,"track":' .. jstr(trackId) .. ',"layout":' .. jstr(layoutId) .. ',"time":' .. tostring(safe(function() return os.time() end, 0)) ..
    ',"cars":[' .. table.concat(cars, ',') .. '],"battle":' .. b .. '}')
end

-- ------------------------------------------------------------- début / fin de run
local function onRunStart(car)
  run.active, run.t0, run.current, run.hint = true, clock, {}, {}
  run.lights = lights.greenAt ~= nil and clock - lights.greenAt < 30000
  resetClips()
  if not tandem.closing then resetTandem() end
  -- fantôme : les secondes d'avant le départ font partie de l'enregistrement
  rec.rows, rec.lastT = {}, -1
  if gated then
    for i = 1, #rec.pre do rec.rows[i] = rec.pre[i] end
    rec.pre = {}
  end
  rec.green = run.lights and lights.greenAt or nil
  if not ghost.running then startGhost(ghost.lead) end
end

-- ------------------------------------------------------------- après la run : tandem et note
-- Résumé tandem calculé ici tout de suite ; la note complète vient du launcher (score.json).
local summary = nil
local scoreView = { data = nil, at = 0, seen = nil, checked = -1e9, started = false, open = false }

local function tandemSummary()
  if tandem.other == nil or (tandem.gapN or 0) < 20 then return nil end
  local name = safe(function() return ac.getDriverName(tandem.other) end, '?')
  local avg = tandem.gapSum / tandem.gapN
  local parts = {}
  for i, c in ipairs(clips) do
    local st = clipState[i]
    if st and st.gap then parts[#parts + 1] = string.format('%s %.1f m', c.name, st.gap) end
  end
  local head = tandem.role == 'lead' and string.format('Devant %s : chaser à %.1f m en moyenne', name, avg) or string.format('Derrière %s : %.1f m en moyenne', name, avg)
  return { at = clock, head = head, clips = #parts > 0 and ('Écart aux clips : ' .. table.concat(parts, ' · ')) or nil }
end

local function checkScore()
  if clock - scoreView.checked < 1000 then return end
  scoreView.checked = clock
  local s = parseJson(readFile('score.json'))
  if s and s.id and s.id ~= scoreView.seen then
    scoreView.seen = s.id
    -- celle déjà là au lancement est d'une session précédente
    if scoreView.started and s.track == trackId then scoreView.data, scoreView.at = s, clock end
  end
  scoreView.started = true
end

local function onRunEnd(car, ms)
  summary = tandemSummary() or summary
  if ms and ms > 0 then
    if run.bestMs == nil or ms < run.bestMs then run.best, run.bestMs = run.current, ms end
    run.lastMs = ms
    local offset = gated and run.t0 or 0
    saveGhost(ms, offset, rec.green and (rec.green - offset) or nil)
    if battle and battle.phase == 'running' and tandem.battle then
      battle.meDone = true
      tandem.closing = clock + 8000 -- on attend que l'autre passe l'arrivée aussi
    else
      saveRun(ms)
      resetTandem()
    end
  end
  run.active = false
  rec.rows, rec.lastT, rec.pre, rec.green = {}, -1, {}, nil
  loadGhost() -- le launcher a pu changer de fantôme
end

local function resetAll(why)
  run.active = false
  resetClips()
  if not tandem.closing then resetTandem() end
  rec.rows, rec.lastT, rec.pre, rec.green = {}, -1, {}, nil
  ghost.running = false
  if lights.state == 'count' then lights.state = 'off' end
  if battle and battle.phase == 'running' and not battle.meDone then battle.phase = 'staging'; battle.lightsSent = false end
  say(why, 3000)
end

-- ------------------------------------------------------------- boucle (même fenêtre fermée)
local state = { angle = 0, gap = nil, delta = nil }
loadGhost()

function script.update(dt)
  clock = clock + dt * 1000
  local car = ac.getCar(0)
  if not car then return end
  local x, z = car.position.x, car.position.z

  -- retour aux stands ou voiture replacée : tout repart à zéro
  local inPit = safe(function() return car.isInPit end, false)
  if prevPos then
    local jump = math.sqrt((x - prevPos.x) ^ 2 + (z - prevPos.z) ^ 2) > 30
    if jump or (inPit and not prevPos.inPit) then resetAll(inPit and 'Retour aux stands : remis à zéro' or 'Voiture replacée : remis à zéro') end
  end

  if gated then
    local d = locate(x, z, run.hint)
    run.d = d
    -- départ au début du tracé, arrivée à la fin (un tracé peut repasser au même endroit)
    if prevPos and not run.active and d < 0.3 and crossesForward(course.start, d, prevPos.x, prevPos.z, x, z) then onRunStart(car)
    elseif prevPos and run.active and d > 0.7 and crossesForward(course.finish, d, prevPos.x, prevPos.z, x, z) then onRunEnd(car, clock - run.t0)
    elseif run.active and clock - run.t0 > 600000 then run.active = false end
  elseif car.lapCount ~= lastLapCount then
    if lastLapCount >= 0 then onRunEnd(car, car.previousLapTimeMs) end
    onRunStart(car)
    lastLapCount = car.lapCount
  end
  prevPos = { x = x, z = z, inPit = inPit }

  local angle = driftAngle(car)
  if run.active then updateClips(car, angle, state.gap) end
  state.angle = angle

  -- tandem : pendant la run (et quelques secondes après en battle)
  if run.active or tandem.closing then
    local t = run.active and runMs(car) or (clock - run.t0)
    state.gap = updateTandem(car, t)
    if tandem.closing then
      local o = tandem.other and ac.getCar(tandem.other)
      if o and gated and tandem.otherPrev and crosses(course.finish, tandem.otherPrev.x, tandem.otherPrev.z, o.position.x, o.position.z) then tandem.otherDone = true end
      if o then tandem.otherPrev = { x = o.position.x, z = o.position.z } end
      if tandem.otherDone or (battle and battle.otherDone) or clock > tandem.closing then
        saveRun(run.lastMs)
        resetTandem()
        battleRunOver()
      end
    elseif tandem.other then
      local o = ac.getCar(tandem.other)
      if o then tandem.otherPrev = { x = o.position.x, z = o.position.z } end
    end
  else
    state.gap = nil
  end

  recordGhost(car)
  updateGhost(car, dt)
  updateLights(car)
  updateBattle(car)
  checkResult()
  checkScore()
  writeLive(car)
  if clock - library.checkedAt > 10000 then loadLibrary() end
  for i = #invites, 1, -1 do if clock - invites[i].at > 30000 then table.remove(invites, i) end end

  -- écart avec ta meilleure run de la session
  if run.active then
    local p = gated and run.d or car.splinePosition
    local bucket = math.floor(p * BUCKETS)
    local t = runMs(car)
    if run.current[bucket] == nil then run.current[bucket] = t end
    state.delta = (run.best and run.best[bucket]) and (t - run.best[bucket]) / 1000 or nil
  else
    state.delta = nil
  end
end

-- ------------------------------------------------------------- 3D : fantôme, clips, porte de départ
local ghostMesh = {
  mesh = ac.SimpleMesh.carShape(0, true),
  transform = mat4x4(),
  textures = {},
  values = {},
  shader = [[
    float4 main(PS_IN pin) {
      float l = saturate(pin.NormalW.y * 0.5 + 0.6);
      return float4(float3(0.9, 0.08, 0.16) * l * gWhiteRefPoint, 0.38 * pin.FogAlphaMultiplier());
    }
  ]],
}

local up = vec3(0, 1, 0)
render.on('main.track.transparent', function()
  if safe(function() return ac.getSim().isReplayActive end, false) then return end
  if ghost.visible and ghost.data and ghost.running then
    render.setBlendMode(render.BlendMode.AlphaBlend)
    render.setCullMode(render.CullMode.None)
    render.setDepthMode(render.DepthMode.ReadOnly)
    ghostMesh.transform = mat4x4.look(gPos, gLook, gUp)
    render.mesh(ghostMesh)
  end
  if show3d and #clips > 0 then
    local car = ac.getCar(0)
    local cy = car and car.position.y or 0
    for i, c in ipairs(clips) do
      local st = clipState[i]
      local col = (st and st.hit) and GREEN or (c.kind == 'outer' and AMBER or RED)
      if car and math.abs(c.x - car.position.x) < 250 and math.abs(c.z - car.position.z) < 250 then
        local pts = c.path or { { c.x, c.z } }
        local r = c.path and math.min(c.r, 1.2) or c.r
        for _, q in ipairs(pts) do
          local p = vec3(q[1], (c.y or cy) + 0.15, q[2])
          if not pcall(render.circle, p, up, r, rgbm(col.r, col.g, col.b, 0.25), col) then
            pcall(render.debugSphere, p, 0.4, col)
          end
        end
      end
    end
  end
  -- lignes de start, de départ et d'arrivée
  if show3d and gated then
    local car = ac.getCar(0)
    local cy = car and car.position.y or 0
    for _, g in ipairs({ { staging, WHITE }, { course.start, GREEN }, { course.finish, RED } }) do
      local line, col = g[1], g[2]
      if line and car and math.abs(line[1][1] - car.position.x) < 250 and math.abs(line[1][2] - car.position.z) < 250 then
        for k = 0, 6 do
          local x = line[1][1] + (line[2][1] - line[1][1]) * k / 6
          local z = line[1][2] + (line[2][2] - line[1][2]) * k / 6
          pcall(render.debugSphere, vec3(x, cy + 0.2, z), 0.25, col)
        end
      end
    end
  end
  if gated and lights.state ~= 'off' then
    local col = lights.state == 'green' and GREEN or (lights.state == 'false' and AMBER or RED)
    local sl = staging or course.start
    local mx, mz = (sl[1][1] + sl[2][1]) / 2, (sl[1][2] + sl[2][2]) / 2
    local car = ac.getCar(0)
    local y = (car and car.position.y or 0) + 4
    for k = 1, 3 do
      local on = lights.state ~= 'count' or lights.lit >= k
      pcall(render.debugSphere, vec3(mx + (k - 2) * 1.2, y, mz), 0.45, on and col or DARK)
    end
  end
end)

-- ------------------------------------------------------------- fenêtres
local function fmtMs(ms)
  if not ms then return '—' end
  local s = ms / 1000
  return string.format('%d:%04.1f', math.floor(s / 60), s % 60)
end

local function drawLights(size)
  local p = safe(function() return ui.getCursor() end, nil)
  if p and ui.drawCircleFilled then
    for k = 1, 4 do
      local col = DARK
      if k <= 3 and lights.state == 'count' and lights.lit >= k then col = RED end
      if lights.state == 'green' then col = GREEN end
      if lights.state == 'false' and k <= 3 then col = AMBER end
      pcall(ui.drawCircleFilled, vec2(p.x + size * (k - 0.5) * 1.2, p.y + size * 0.6), size / 2, col, 24)
    end
    pcall(ui.dummy, vec2(size * 4.8, size * 1.2))
  end
  if lights.state == 'count' then ui.textColored(tostring(3 - lights.lit) == '0' and '...' or tostring(3 - lights.lit), RED)
  elseif lights.state == 'green' then ui.textColored('GO !', GREEN)
  elseif lights.state == 'false' then ui.textColored('Faux départ', AMBER) end
end

function script.windowLights(dt)
  drawLights(46)
end

local function ghostPanel()
  ui.textColored('Fantôme à suivre', GREY)
  if ui.button((ghost.source == 'launcher' and '● ' or '') .. 'Choisi dans le launcher') then pickGhost('launcher') end
  for _, it in ipairs(library.items) do
    local label = string.format('%s%s · %s', ghost.id == it.file and '● ' or '', tostring(it.driver or '?'), it.score and (tostring(it.score) .. '/100') or fmtMs(it.lapMs))
    if ui.button(label) then pickGhost(it) end
  end
  if ui.button('Aucun fantôme') then pickGhost(nil) end
  if #library.items == 0 then ui.textColored('Les meilleures runs avec fantôme arrivent ici depuis le launcher.', GREY) end
end

local function battlePanel()
  if not online then
    ui.textColored('Les battles se lancent sur un serveur.', GREY)
    return
  end
  if battle then
    ui.textColored(string.format('Battle contre %s', tostring(battle.name)), GREEN)
    if ui.button('Annuler la battle') then cancelBattle() end
    return
  end
  for _, inv in ipairs(invites) do
    ui.textColored(tostring(inv.name) .. ' te défie', AMBER)
    if ui.button('Accepter') then acceptInvite(inv) end
    ui.sameLine()
    if ui.button('Refuser') then
      send(KIND.cancel, inv.sid, inv.tag)
      invites = {}
    end
  end
  ui.textColored('Défier un pilote :', GREY)
  local count = safe(function() return ac.getSim().carsCount end, 1)
  local me = ac.getCar(0)
  local n = 0
  for i = 1, count - 1 do
    local c = ac.getCar(i)
    if c and safe(function() return c.isConnected end, true) and me then
      n = n + 1
      local dist = math.sqrt((c.position.x - me.position.x) ^ 2 + (c.position.z - me.position.z) ^ 2)
      if ui.button(string.format('%s (%.0f m)', safe(function() return ac.getDriverName(i) end, '?'), dist)) then challenge(i) end
    end
  end
  if n == 0 then ui.textColored('Personne d’autre sur le serveur.', GREY) end
end

function script.windowMain(dt)
  ui.pushFont(ui.Font.Huge)
  ui.text(string.format('%2.0f°', state.angle))
  ui.popFont()

  if note.text and clock < note.untilT then ui.textColored(note.text, AMBER) end
  if result and clock - result.at < 20000 then ui.textColored(result.text, GREEN) end

  -- note de la dernière run (écrite par le launcher)
  local sc = scoreView.data
  if sc and (scoreView.open or clock - scoreView.at < 30000) then
    if sc.kind == 'tandem' then
      ui.textColored(string.format('Chase de %s : %s/100', tostring(sc.driver or '?'), tostring(sc.score or 0)), GREEN)
      if sc.tandem then ui.textColored(string.format('Proximité %s · angle %s · ligne %s · écart moyen %s m', tostring(sc.tandem.proximity or '-'), tostring(sc.tandem.angleMatch or '-'), tostring(sc.tandem.line or '-'), tostring(sc.tandem.avgGap or '-')), GREY) end
    else
      ui.textColored(string.format('Note %s/100%s', tostring(sc.score or 0), sc.record and '  · record !' or ''), GREEN)
      ui.textColored(string.format('Angle %s · Vitesse %s · Ligne %s%s', tostring(sc.angle or '-'), tostring(sc.speed or '-'), tostring(sc.line or '-'), (sc.penalty or 0) > 0 and string.format(' · pénalités -%s', tostring(sc.penalty)) or ''), GREY)
      if sc.zeroed then ui.textColored('Run à 0 : ' .. tostring(sc.zeroed), RED) end
    end
    if type(sc.clips) == 'table' then
      for _, c in ipairs(sc.clips) do
        local txt = (c.hit and '✓ ' or '✗ ') .. tostring(c.name) .. (c.cover and string.format(' (%s %%)', tostring(c.cover)) or '')
        if type(sc.zones) == 'table' then
          for _, z in ipairs(sc.zones) do if z.name == c.name then txt = txt .. string.format(' · zone %s/100', tostring(z.score)) end end
        end
        ui.textColored(txt, c.hit and GREEN or RED)
      end
    end
  elseif sc then
    ui.textColored(string.format('Dernière note : %s/100', tostring(sc.score or 0)), GREY)
  end
  if summary and clock - summary.at < 30000 then
    ui.textColored(summary.head, GREY)
    if summary.clips then ui.textColored(summary.clips, GREY) end
  end

  -- run
  if gated then
    if run.active then ui.textColored('Run ' .. fmtMs(clock - run.t0), GREEN)
    else ui.textColored(run.lastMs and ('Dernière run ' .. fmtMs(run.lastMs)) or (staging and 'Ligne de start, feux, puis ligne de départ' or 'Passe la ligne de départ'), GREY) end
  end

  if #clips > 0 then
    local hit = 0
    for i = 1, #clipState do if clipState[i].hit then hit = hit + 1 end end
    ui.textColored(string.format('Clips %d / %d', hit, #clips), hit > 0 and GREEN or GREY)
    if lastClip then ui.textColored(lastClip, GREEN) end
  end

  if battle and battle.phase ~= 'invited' then
    local role = battleRole() == 'lead' and 'devant' or 'derrière'
    local txt = string.format('Battle %d/2 contre %s : %s', battle.run, tostring(battle.name), role)
    if battle.phase == 'staging' then txt = txt .. (battle.meReady and (battle.otherReady and ' · départ…' or ' · attends l’autre') or (staging and ' · arrête-toi sur la ligne de start' or ' · arrête-toi avant le départ')) end
    if battle.phase == 'done' then txt = 'Battle finie : résultat dans un instant' end
    ui.textColored(txt, AMBER)
  elseif battle then
    ui.textColored('Défi envoyé à ' .. tostring(battle.name) .. '…', GREY)
  end

  local gap = state.gap
  if gap then
    ui.textColored(string.format(tandem.role == 'lead' and 'Lead : chaser à %.1f m' or 'Chase : %.1f m', gap), gap < 5 and GREEN or GREY)
  elseif tandem.saved then
    ui.textColored(tandem.saved, GREY)
  end

  if state.delta then
    ui.pushFont(ui.Font.Title)
    ui.textColored(string.format('%+.2f s', state.delta), state.delta <= 0 and GREEN or RED)
    ui.popFont()
  end

  if lights.state ~= 'off' then drawLights(22) end

  -- fantôme
  if ghost.data then
    ui.textColored(string.format('Fantôme : %s', tostring(ghost.data.driver or '?')), GREY)
    if ghost.running and ghost.gap then ui.textColored(string.format('à %.0f m', ghost.gap), ghost.gap < 8 and GREEN or GREY)
    elseif not ghost.running then ui.textColored(gated and 'Il part à la ligne de départ, ou au vert des feux' or 'Il part au prochain passage de la ligne', GREY) end
  elseif ghost.note then
    ui.textColored(ghost.note, GREY)
  end

  -- boutons
  if ui.button('Feux') then
    local car = ac.getCar(0)
    local ok, why = canStage(car)
    if not ok then say(why, 3000)
    else
      startLights(car, function()
        if ghost.data then
          if ghost.data.green then startGhost(ghost.data.green) end
        end
      end)
    end
  end
  ui.sameLine()
  if ui.button(panel == 'ghost' and 'Fantôme ▴' or 'Fantôme ▾') then panel = panel == 'ghost' and nil or 'ghost' end
  ui.sameLine()
  if ui.button(panel == 'battle' and 'Battle ▴' or 'Battle ▾') then panel = panel == 'battle' and nil or 'battle' end
  ui.sameLine()
  if ui.button(panel == 'options' and '⋯' or '⋯ ') then panel = panel == 'options' and nil or 'options' end
  if scoreView.data then
    ui.sameLine()
    if ui.button(scoreView.open and 'Note ▴' or 'Note ▾') then scoreView.open = not scoreView.open end
  end

  if panel == 'ghost' then ghostPanel()
  elseif panel == 'battle' then battlePanel()
  elseif panel == 'options' then
    if ui.button(ghost.visible and 'Fantôme : visible' or 'Fantôme : caché') then ghost.visible = not ghost.visible end
    if ui.button(ghost.wait and 'Fantôme t’attend : oui' or 'Fantôme t’attend : non') then ghost.wait = not ghost.wait end
    if ui.button(string.format('Avance du fantôme : %.1f s', ghost.lead / 1000)) then ghost.lead = (ghost.lead + 500) % 2500 end
    if ui.button(show3d and 'Clips sur la piste : oui' or 'Clips sur la piste : non') then show3d = not show3d end
    if course.official then ui.textColored('Parcours officiel : ' .. tostring(course.official), GREY) end
  end
end
