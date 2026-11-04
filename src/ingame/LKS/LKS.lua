-- LKS : appli en jeu pour le Custom Shaders Patch.
-- Angle de drift, clips du parcours et écart avec ton meilleur tour de la session.
-- Tandem : quand une voiture roule devant ou derrière toi, la run est
-- enregistrée dans runs/ et le launcher note le chase et les battles.
-- Fantôme : une voiture translucide rejoue une run choisie dans le launcher.
-- La note complète s'affiche dans le launcher.

local BUCKETS = 1000
local best = nil        -- temps (ms) par portion du meilleur tour de la session
local bestTime = nil
local current = {}
local lastLapCount = -1
-- circuit sans ligne IA (pas de ai/fast_lane.ai) : splinePosition ne bouge pas
local splineOk, lastSpline = false, nil

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
-- Une run est enregistrée quand une autre voiture roule à moins de 35 m :
--   devant toi  -> tu es le chaser (role "chase")
--   derrière toi -> tu es le leader (role "lead"), la run du chaser est
--                  enregistrée aussi : avec les deux runs inversées, le
--                  launcher juge la battle.
local tandem = { other = nil, role = nil, rows = {}, frames = 0, withFrames = 0, lastT = -1, lastD = -1, saved = nil, lost = 0, m = 0, lastM = -1, lastPos = nil, firstD = nil, splineMoved = false }

local function num(v) return string.format('%.2f', tonumber(v) or 0) end
local function jstr(v) return '"' .. tostring(v or ''):gsub('[%c"\\]', ' ') .. '"' end

local function safe(fn, default)
  local ok, v = pcall(fn)
  if ok and v ~= nil then return v end
  return default
end

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

local function saveRun(me)
  local rows = tandem.rows
  if tandem.other == nil or #rows < 40 or tandem.withFrames < tandem.frames * 0.5 then return end
  local other = tandem.other
  local chaser, leader = 0, other
  if tandem.role == 'lead' then chaser, leader = other, 0 end
  local out = {}
  for i = 1, #rows do out[i] = '[' .. table.concat(rows[i], ',') .. ']' end
  local stamp = tostring(safe(function() return os.time() end, math.random(1, 1e9))) .. '-' .. tostring(math.random(1000, 9999))
  local json = '{"v":1,"role":' .. jstr(tandem.role) ..
    ',"track":' .. jstr(safe(function() return ac.getTrackID() end, '')) ..
    ',"layout":' .. jstr(safe(function() return ac.getTrackLayout() end, '')) ..
    ',"car":' .. jstr(safe(function() return ac.getCarID(chaser) end, '')) ..
    ',"driver":' .. jstr(safe(function() return ac.getDriverName(chaser) end, '')) ..
    ',"lead":{"name":' .. jstr(safe(function() return ac.getDriverName(leader) end, '')) .. ',"car":' .. jstr(safe(function() return ac.getCarID(leader) end, '')) .. '}' ..
    ',"recordedBy":' .. jstr(safe(function() return ac.getDriverName(0) end, '')) ..
    ',"time":' .. tostring(safe(function() return os.time() end, 0)) ..
    ',"lapMs":' .. tostring(me.previousLapTimeMs or 0) ..
    ',"rows":[' .. table.concat(out, ',') .. ']}'
  local okDir, dir = pcall(function() return __dirname end)
  local ok = pcall(function()
    local f = io.open(((okDir and dir) or '.') .. '/runs/' .. stamp .. '.json', 'w')
    f:write(json)
    f:close()
  end)
  local name = safe(function() return ac.getDriverName(other) end, '?')
  if not ok then tandem.saved = 'Tandem : enregistrement impossible'
  elseif tandem.role == 'lead' then tandem.saved = 'Run enregistrée devant ' .. name
  else tandem.saved = 'Tandem enregistré derrière ' .. name end
end

local function resetTandem()
  tandem.other, tandem.role, tandem.rows, tandem.frames, tandem.withFrames, tandem.lastT, tandem.lastD, tandem.lost = nil, nil, {}, 0, 0, -1, -1, 0
  tandem.m, tandem.lastM, tandem.lastPos, tandem.firstD, tandem.splineMoved = 0, -1, nil, nil, false
end

local function updateTandem(me)
  tandem.frames = tandem.frames + 1
  if tandem.other == nil then tandem.other, tandem.role = findPartner(me) end
  if tandem.other == nil then return nil end
  local o = ac.getCar(tandem.other)
  if not o then resetTandem() return nil end
  local dx, dz = o.position.x - me.position.x, o.position.z - me.position.z
  local gap = math.sqrt(dx * dx + dz * dz)
  if gap > 80 then
    tandem.lost = tandem.lost + 1
    if tandem.lost > 300 then resetTandem() end
    return nil
  end
  tandem.lost = 0
  tandem.withFrames = tandem.withFrames + 1
  local c, l = me, o -- chaser, leader
  if tandem.role == 'lead' then c, l = o, me end
  -- un échantillon toutes les 50 ms, toujours en avançant
  local t = me.lapTimeMs
  local d = safe(function() return c.splinePosition end, me.splinePosition)
  -- distance parcourue par le chaser : sert d'avancement sur les circuits sans ligne IA
  local cp = c.position
  if tandem.lastPos then
    local step = math.sqrt((cp.x - tandem.lastPos[1]) ^ 2 + (cp.z - tandem.lastPos[2]) ^ 2)
    if step < 30 then tandem.m = (tandem.m or 0) + step end
  end
  tandem.lastPos = { cp.x, cp.z }
  if tandem.firstD == nil then tandem.firstD = d elseif d ~= tandem.firstD then tandem.splineMoved = true end
  local ahead = (tandem.splineMoved and d > tandem.lastD) or (not tandem.splineMoved and tandem.m > tandem.lastM + 0.3)
  if t - tandem.lastT >= 50 and ahead then
    tandem.lastT, tandem.lastD, tandem.lastM = t, d, tandem.m
    local cw = safe(function() return me.collidedWith end, -1)
    local contact = (cw == tandem.other) and 1 or 0
    local rows = tandem.rows
    if #rows < 20000 then
      rows[#rows + 1] = { tostring(t), string.format('%.5f', d), num(c.position.x), num(c.position.z), num(c.speedKmh), num(slipAngle(c)),
        num(safe(function() return c.gas end, 0)), num(safe(function() return c.brake end, 0)), tostring(safe(function() return c.gear end, 0) + 1), tostring(safe(function() return c.wheelsOutside end, 0)),
        num(l.position.x), num(l.position.z), num(slipAngle(l)), num(l.speedKmh), tostring(contact), num(tandem.m) }
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

-- ------------------------------------------------------------- fantôme
-- Enregistrement : chaque tour complet est écrit dans ghosts/ (position et
-- orientation 20 fois par seconde) ; le launcher le range avec le tour.
-- Lecture : le launcher écrit ghost.json (une run choisie, la tienne ou celle
-- d'un autre pilote) ; une voiture translucide la rejoue à chaque tour.
local rec = { rows = {}, lastT = -1 }
local ghost = { data = nil, t = 0, running = false, lead = 500, wait = true, visible = true, gap = nil, note = nil }
local trackId = safe(function() return ac.getTrackID() end, '')
local layoutId = safe(function() return ac.getTrackLayout() end, '')

local function appDir()
  local okDir, dir = pcall(function() return __dirname end)
  return (okDir and dir) or '.'
end

local function recordGhost(car)
  local t = car.lapTimeMs
  if t - rec.lastT < 50 or #rec.rows >= 20000 then return end
  rec.lastT = t
  local p, l, u = car.position, car.look, car.up
  rec.rows[#rec.rows + 1] = table.concat({ tostring(t), num(p.x), num(p.y), num(p.z),
    string.format('%.4f', l.x), string.format('%.4f', l.y), string.format('%.4f', l.z),
    string.format('%.4f', u.x), string.format('%.4f', u.y), string.format('%.4f', u.z), num(car.speedKmh) }, ',')
end

local function saveGhost(car)
  local rows = rec.rows
  if (car.previousLapTimeMs or 0) <= 0 or #rows < 40 then return end
  local stamp = tostring(safe(function() return os.time() end, math.random(1, 1e9))) .. '-' .. tostring(math.random(1000, 9999))
  local json = '{"v":1,"track":' .. jstr(trackId) .. ',"layout":' .. jstr(layoutId) ..
    ',"car":' .. jstr(safe(function() return ac.getCarID(0) end, '')) ..
    ',"driver":' .. jstr(safe(function() return ac.getDriverName(0) end, '')) ..
    ',"time":' .. tostring(safe(function() return os.time() end, 0)) ..
    ',"lapMs":' .. tostring(car.previousLapTimeMs) ..
    ',"rows":[[' .. table.concat(rows, '],[') .. ']]}'
  pcall(function()
    local f = io.open(appDir() .. '/ghosts/' .. stamp .. '.json', 'w')
    f:write(json)
    f:close()
  end)
end

local function loadGhost()
  ghost.data = nil
  local raw = safe(function() return io.load(appDir() .. '/ghost.json') end, nil)
  if not raw or raw == '' then return end
  local ok, g = pcall(function() return JSON.parse(raw) end)
  if not ok or type(g) ~= 'table' or type(g.rows) ~= 'table' or #g.rows < 10 then return end
  if g.track ~= trackId or (g.layout or '') ~= (layoutId or '') then
    ghost.note = 'Fantôme prévu pour un autre circuit'
    return
  end
  ghost.data = g
  ghost.note = nil
end

-- position du fantôme au temps t (ms) : interpolation entre deux échantillons
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
  -- « attendre » : le fantôme ralentit quand tu es loin derrière
  local rate = 1
  if ghost.wait and ghost.gap > 20 then rate = math.max(0.35, 1 - (ghost.gap - 20) / 40) end
  ghost.t = ghost.t + dt * 1000 * rate
  if ghost.t > rows[#rows][1] + 2000 then ghost.running = false end
end

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

render.on('main.track.transparent', function ()
  if not ghost.visible or not ghost.data or not ghost.running then return end
  if safe(function() return ac.getSim().isReplayActive end, false) then return end
  render.setBlendMode(render.BlendMode.AlphaBlend)
  render.setCullMode(render.CullMode.None)
  render.setDepthMode(render.DepthMode.ReadOnly)
  ghostMesh.transform = mat4x4.look(gPos, gLook, gUp)
  render.mesh(ghostMesh)
end)

loadGhost()

-- ------------------------------------------------------------- boucle (même fenêtre fermée)
local state = { angle = 0, gap = nil, delta = nil }

function script.update(dt)
  local car = ac.getCar(0)
  if not car then return end

  -- nouveau tour : meilleur tour de référence, clips, tandem, fantôme
  if car.lapCount ~= lastLapCount then
    if lastLapCount >= 0 and car.previousLapTimeMs > 0 and (bestTime == nil or car.previousLapTimeMs < bestTime) then
      best = current
      bestTime = car.previousLapTimeMs
    end
    current = {}
    resetClips()
    if lastLapCount >= 0 then
      saveRun(car)
      saveGhost(car)
    end
    resetTandem()
    rec.rows, rec.lastT = {}, -1
    loadGhost() -- le launcher a pu changer de fantôme
    ghost.t, ghost.running = ghost.lead, ghost.data ~= nil
    lastLapCount = car.lapCount
  end

  local angle = driftAngle(car)
  updateClips(car, angle)
  state.angle = angle
  state.gap = updateTandem(car)
  recordGhost(car)
  updateGhost(car, dt)

  if car.speedKmh > 30 and lastSpline ~= nil and car.splinePosition ~= lastSpline then splineOk = true end
  lastSpline = car.splinePosition
  if not splineOk then state.delta = nil return end -- pas de ligne IA : pas d'écart en direct
  local bucket = math.floor(car.splinePosition * BUCKETS)
  if current[bucket] == nil then current[bucket] = car.lapTimeMs end
  state.delta = (best and best[bucket]) and (car.lapTimeMs - best[bucket]) / 1000 or nil
end

function script.windowMain(dt)
  ui.pushFont(ui.Font.Huge)
  ui.text(string.format('%2.0f°', state.angle))
  ui.popFont()

  if #clips > 0 then
    local hit = 0
    for i = 1, #clipState do if clipState[i].hit then hit = hit + 1 end end
    ui.textColored(string.format('Clips %d / %d', hit, #clips), hit > 0 and GREEN or GREY)
    if lastClip then ui.textColored(lastClip, GREEN) end
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
  else
    ui.textColored('Écart : après un tour complet', GREY)
  end

  -- fantôme
  if ghost.data then
    local g = ghost.data
    ui.textColored(string.format('Fantôme : %s', tostring(g.driver or '?')), GREY)
    if ghost.running and ghost.gap then
      ui.textColored(string.format('à %.0f m', ghost.gap), ghost.gap < 8 and GREEN or GREY)
    elseif not ghost.running then
      ui.textColored('Départ au prochain passage de la ligne', GREY)
    end
    if ui.button(ghost.visible and 'Masquer' or 'Afficher') then ghost.visible = not ghost.visible end
    ui.sameLine()
    if ui.button(ghost.wait and 'Attente : oui' or 'Attente : non') then ghost.wait = not ghost.wait end
    ui.sameLine()
    if ui.button(string.format('Avance %.1f s', ghost.lead / 1000)) then ghost.lead = (ghost.lead + 500) % 2500 end
  elseif ghost.note then
    ui.textColored(ghost.note, GREY)
  end
end
