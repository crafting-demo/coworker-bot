-- auth.lua — MCP proxy authentication helpers
-- Loaded once at startup via init_by_lua_block in nginx.conf.

local _M = {}

-- Injects a Bearer token sourced from an environment variable.
-- Responds with 502 if the variable is unset or empty.
function _M.inject_bearer_from_env(env_var)
    local token = os.getenv(env_var)
    if not token or #token == 0 then
        ngx.status = 502
        ngx.say(env_var .. " not set")
        ngx.exit(502)
    end
    ngx.req.set_header("Authorization", "Bearer " .. token)
end

-- Injects a GitHub Bearer token fetched via git-credentials, with caching.
-- shared_dict_name: name of the lua_shared_dict defined in nginx.conf
-- github_org_env:   name of the env var holding the GitHub org
function _M.inject_github_token(shared_dict_name, github_org_env)
    local function fail(msg)
        ngx.log(ngx.ERR, msg)
        ngx.status = 502
        ngx.say("failed to obtain GitHub token")
        ngx.exit(502)
    end

    local cache = ngx.shared[shared_dict_name]
    local token = cache:get("token")

    if not token or #token == 0 then
        local repo = os.getenv(github_org_env) .. "/coworker-bot"
        local input = "protocol=https\nhost=github.com\npath=" .. repo .. "\n"
        local tmpfile = os.tmpname()
        local fh = io.open(tmpfile, "w")
        fh:write(input)
        fh:close()
        local handle = io.popen("/opt/sandboxd/sbin/wsenv git-credentials get < " .. tmpfile)
        local stdout = handle:read("*a")
        handle:close()
        os.remove(tmpfile)

        if not stdout or #stdout == 0 then
            fail("git-credentials get failed: empty output")
        end

        for line in stdout:gmatch("[^\n]+") do
            local pw = line:match("^password=(.+)")
            if pw then token = pw; break end
        end

        if not token or #token == 0 then
            fail("git-credentials response contained no password field")
        end

        cache:set("token", token, 3300)
    end

    ngx.req.set_header("Authorization", "Bearer " .. token)
end

return _M
