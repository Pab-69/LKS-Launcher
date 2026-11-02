-- LKS : appli en jeu pour le Custom Shaders Patch.
-- Angle de drift, clips du parcours et écart avec ton meilleur tour de la session.
-- Tandem : quand une voiture roule devant toi, la run (toi + elle) est
-- enregistrée dans runs/ et le launcher note ton chase.
-- La note complète s'affiche dans le launcher.

local BUCKETS = 1000
local best = nil        -- temps (ms) par portion du meilleur tour de la session
local bestTime = nil
local current = {}
local lastLapCount = -1

-- LuaJIT (CSP) a math.atan2 ; Lua 5.3+ utilise math.atan(y, x)
local atan2 = math.atan2 or math.atan

local GREEN = rgbm(0.25, 0.85, 0.5, 1)
local RED = rgbm(0.88, 0.11, 0.23, 1)
local GREY = rgbm(0.66, 0.61, 0.58, 1)

-- clips publiés par les admins (fichier écrit par le launcher)
local clips = {}
local clipState = {}
local lastClip = nil
do
  local okDir, dir = pcall(function() return __dirname end)
  local okFile, courses = pcall(dofile, ((okDir and dir) or '.') .. '/courses.lua')
  local okTrack, track = pcall(function() return ac.getTrackID() end)
  local okLayout, layout = pcall(function() return ac.getTrackLayout() end)
  if okFile and type(courses) == 'table' and okTrack and track then
    local course = courses[track .. '|' .. ((okLayout and layout) or '')]
    if course and course.clips then clips = course.clips end
  end
end

local function resetClips()
  clipState = {}
  for i = 1, #clips do clipState[i] = { hit = false, best = nil } end
  lastClip = nil
end
resetClips()

-- angle signé (le signe dit de quel côté la voiture glisse)
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

-- ------------------------------------------------------------- tandem
local tandem = { lead = nil, rows = {}, frames = 0, leadFrames = 0, lastT = -1, lastD = -1, saved = nil, lost = 0 }

local function num(v) return string.format('%.2f', tonumber(v) or 0) end
local function jstr(v) return '"' .. tostring(v or ''):gsub('[%c"\\]', ' ') .. '"' end

local function safe(fn, default)
  local ok, v = pcall(fn)
  if ok and v ~= nil then return v end
  return default
end

-- voiture la plus proche devant toi (moins de 35 m)
local function findLead(me)
  local count = safe(function() return ac.getSim().carsCount end, 1)
  local best, bestDist = nil, 35
  for i = 1, count - 1 do
    local c = ac.getCar(i)
    if c and safe(function() return c.isConnected end, true) and c.speedKmh > 10 then
      local dx, dz = c.position.x - me.position.x, c.position.z - me.position.z
      local dist = math.sqrt(dx * dx + dz * dz)
      local ahead = dx * me.look.x + dz * me.look.z > 0
      if ahead and dist < bestDist then best, bestDist = i, dist end
    end
  end
  return best
end

local function saveRun(me)
  local rows = tandem.rows
  if tandem.lead == nil or #rows < 40 or tandem.leadFrames < tandem.frames * 0.5 then return end
  local lead = tandem.lead
  local out = {}
  for i = 1, #rows do out[i] = '[' .. table.concat(rows[i], ',') .. ']' end
  local stamp = tostring(safe(function() return os.time() end, math.random(1, 1e9))) .. '-' .. tostring(math.random(1000, 9999))
  local json = '{"v":1,"track":' .. jstr(safe(function() return ac.getTrackID() end, '')) ..
    ',"layout":' .. jstr(safe(function() return ac.getTrackLayout() end, '')) ..
    ',"car":' .. jstr(safe(function() return ac.getCarID(0) end, '')) ..
    ',"driver":' .. jstr(safe(function() return ac.getDriverName(0) end, '')) ..
    ',"lead":{"name":' .. jstr(safe(function() return ac.getDriverName(lead) end, '')) .. ',"car":' .. jstr(safe(function() return ac.getCarID(lead) end, '')) .. '}' ..
    ',"lapMs":' .. tostring(me.previousLapTimeMs or 0) ..
    ',"rows":[' .. table.concat(out, ',') .. ']}'
  local okDir, dir = pcall(function() return __dirname end)
  local ok = pcall(function()
    local f = io.open(((okDir and dir) or '.') .. '/runs/' .. stamp .. '.json', 'w')
    f:write(json)
    f:close()
  end)
  tandem.saved = ok and ('Tandem enregistré derrière ' .. safe(function() return ac.getDriverName(lead) end, '?')) or 'Tandem : enregistrement impossible'
end

local function resetTandem()
  tandem.lead, tandem.rows, tandem.frames, tandem.leadFrames, tandem.lastT, tandem.lastD, tandem.lost = nil, {}, 0, 0, -1, -1, 0
end

local function updateTandem(me)
  tandem.frames = tandem.frames + 1
  if tandem.lead == nil then tandem.lead = findLead(me) end
  if tandem.lead == nil then return nil end
  local l = ac.getCar(tandem.lead)
  if not l then tandem.lead = nil return nil end
  local dx, dz = l.position.x - me.position.x, l.position.z - me.position.z
  local gap = math.sqrt(dx * dx + dz * dz)
  if gap > 80 then
    tandem.lost = tandem.lost + 1
    if tandem.lost > 300 then resetTandem() end
    return nil
  end
  tandem.lost = 0
  tandem.leadFrames = tandem.leadFrames + 1
  -- un échantillon toutes les 50 ms, toujours en avançant
  local t, d = me.lapTimeMs, me.splinePosition
  if t - tandem.lastT >= 50 and d > tandem.lastD then
    tandem.lastT, tandem.lastD = t, d
    local cw = safe(function() return me.collidedWith end, -1)
    local contact = (cw == tandem.lead) and 1 or 0
    local rows = tandem.rows
    if #rows < 20000 then
      rows[#rows + 1] = { tostring(t), string.format('%.5f', d), num(me.position.x), num(me.position.z), num(me.speedKmh), num(slipAngle(me)),
        num(me.gas), num(me.brake), tostring((me.gear or 0) + 1), tostring(safe(function() return me.wheelsOutside end, 0)),
        num(l.position.x), num(l.position.z), num(slipAngle(l)), num(l.speedKmh), tostring(contact) }
    end
  end
  return gap
end

local function updateClips(car, angle)
  if #clips == 0 then return end
  local p = car.position
  for i, c in ipairs(clips) do
    local dist = math.sqrt((p.x - c.x) ^ 2 + (p.z - c.z) ^ 2)
    local st = clipState[i]
    if dist < c.r * 4 then
      if st.best == nil or dist < st.best then st.best = dist end
      if not st.hit and dist <= c.r and angle >= 12 and car.speedKmh >= 25 then
        st.hit = true
        lastClip = string.format('%s ✓ %.1f m', c.name, dist)
      end
    end
  end
end

function script.windowMain(dt)
  local car = ac.getCar(0)
  if not car then return end

  -- nouveau tour : garder le meilleur tour comme référence, remettre les clips à zéro
  if car.lapCount ~= lastLapCount then
    if lastLapCount >= 0 and car.previousLapTimeMs > 0 and (bestTime == nil or car.previousLapTimeMs < bestTime) then
      best = current
      bestTime = car.previousLapTimeMs
    end
    current = {}
    resetClips()
    if lastLapCount >= 0 then saveRun(car) end
    resetTandem()
    lastLapCount = car.lapCount
  end

  local angle = driftAngle(car)
  updateClips(car, angle)
  local gap = updateTandem(car)

  local bucket = math.floor(car.splinePosition * BUCKETS)
  if current[bucket] == nil then current[bucket] = car.lapTimeMs end

  ui.pushFont(ui.Font.Huge)
  ui.text(string.format('%2.0f°', angle))
  ui.popFont()

  if #clips > 0 then
    local hit = 0
    for i = 1, #clipState do if clipState[i].hit then hit = hit + 1 end end
    ui.textColored(string.format('Clips %d / %d', hit, #clips), hit > 0 and GREEN or GREY)
    if lastClip then ui.textColored(lastClip, GREEN) end
  end

  if gap then
    ui.textColored(string.format('Tandem : %.1f m', gap), gap < 5 and GREEN or GREY)
  elseif tandem.saved then
    ui.textColored(tandem.saved, GREY)
  end

  if best and best[bucket] then
    local delta = (car.lapTimeMs - best[bucket]) / 1000
    ui.pushFont(ui.Font.Title)
    ui.textColored(string.format('%+.2f s', delta), delta <= 0 and GREEN or RED)
    ui.popFont()
  else
    ui.textColored('Écart : après un tour complet', GREY)
  end
end
