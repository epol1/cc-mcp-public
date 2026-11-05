// pr-cut host bootstrap. Loaded once into Premiere's ExtendScript engine by CEP.
// Scripts arrive through the bridge's /eval; nothing else lives here.
$.global.__prcHost = {
  version: "0.1.0",
  ping: function () {
    return "pong:" + app.version;
  }
};
