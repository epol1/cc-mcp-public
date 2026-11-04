// ae-compose host bootstrap. Loaded once into AE's ExtendScript engine by CEP.
// The real runtime library is loaded on demand by the bridge via $.evalFile.
$.global.__aecHost = {
  version: "0.1.0",
  ping: function () {
    return "pong:" + app.version;
  }
};
