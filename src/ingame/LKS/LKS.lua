-- LKS : appli en jeu pour le Custom Shaders Patch.
-- Angle de drift, clips du parcours et écart avec ton meilleur tour de la session.
-- La note complète (angle, vitesse, ligne, clips) s'affiche dans le launcher.

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

local function driftAngle(car)
  if car.speedKmh < 10 then return 0 end
  local v = car.localVelocity
  local a = math.abs(math.deg(atan2(v.x, v.z)))
  if a > 90 then a = 180 - a end
  return a
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
    lastLapCount = car.lapCount
  end

  local angle = driftAngle(car)
  updateClips(car, angle)

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

  if best and best[bucket] then
    local delta = (car.lapTimeMs - best[bucket]) / 1000
    ui.pushFont(ui.Font.Title)
    ui.textColored(string.format('%+.2f s', delta), delta <= 0 and GREEN or RED)
    ui.popFont()
  else
    ui.textColored('Écart : après un tour complet', GREY)
  end
end
