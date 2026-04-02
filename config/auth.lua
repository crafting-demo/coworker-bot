-- auth.lua — MCP proxy authentication helpers
-- Loaded once at startup via init_by_lua_block in nginx.conf.

local _M = {}

function github_token_from_pat()
    local token = os.getenv("GITHUB_PERSONAL_ACCESS_TOKEN")
    if not token or #token == 0 then
        token = os.getenv("GITHUB_PAT")
    end
    return token
end

function github_token_from_app()
    local org = os.getenv("GITHUB_ORG")
    if not org or #org == 0 then
        return ""
    end


    local input = "protocol=https\nhost=github.com\npath=" .. org .. "/any\n"
    local tmpfile = os.tmpname()
    local fh = io.open(tmpfile, "w")
    if fh then
        fh:write(input)
        fh:close()
    else
        return ""
    end
    local handle = io.popen("/opt/sandboxd/sbin/wsenv git-credentials get <" .. tmpfile)
    local output = ""
    if handle then
        output = handle:read("*a")
        handle:close()
    end
    os.remove(tmpfile)

    for line in output:gmatch("[^\n]+") do
        local pw = line:match("^password=(.+)")
        if pw then
            return pw
        end
    end
    return ""
end

function github_token()
    local token = github_token_from_pat()
    if not token or #token == 0 then
        token = github_token_from_app()
    end
    return token
end

-- Injects a Bearer token sourced from an environment variable.
-- Responds with 502 if the variable is unset or empty.
function _M.inject_bearer_from_env(env_var)
    local token = os.getenv(env_var)
    if not token or #token == 0 then
        ngx.status = 502
        ngx.say(env_var .. " not set")
        ngx.exit(502)
    else
        ngx.req.set_header("Authorization", "Bearer " .. token)
    end
end

-- Injects a GitHub Bearer token from env or fetched via git-credentials (when GitHub App is enabled), with caching.
-- shared_dict_name: name of the lua_shared_dict defined in nginx.conf
function _M.inject_github_token(shared_dict_name)
    if ngx.req.get_headers()["Authorization"] then
        return
    end

    local cache = ngx.shared[shared_dict_name]
    local token = cache:get("token")

    if not token or #token == 0 then
        token = github_token()
    end

    if not token or #token == 0 then
        ngx.status = 502
        ngx.say("failed to obtain GitHub token")
        ngx.exit(502)
    else
        cache:set("token", token, 3300)
        ngx.req.set_header("Authorization", "Bearer " .. token)
    end
end

return _M
