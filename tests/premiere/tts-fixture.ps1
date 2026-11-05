param([string]$Out = "E:\Projects\ae-mcp-prcut\scratch\pr\speech\tts1", [string]$Text = "")
# Speaks a known script with Windows SAPI to a WAV and records each word's start (SpeakProgress), as ground truth for
# transcription accuracy tests. Writes <Out>.wav and <Out>.truth.json.
Add-Type -AssemblyName System.Speech
Add-Type -ReferencedAssemblies System.Speech @"
using System; using System.Collections.Generic; using System.Speech.Synthesis;
public class TtsTruth {
  public static List<string> Run(string text, string wav) {
    var res = new List<string>();
    using (var s = new SpeechSynthesizer()) {
      s.Rate = 0;
      s.SetOutputToWaveFile(wav);
      s.SpeakProgress += (o, e) => res.Add(e.AudioPosition.TotalMilliseconds + "\t" + e.Text);
      var pb = new PromptBuilder();
      foreach (var part in text.Split('|')) { pb.AppendText(part); pb.AppendBreak(TimeSpan.FromMilliseconds(900)); }
      s.Speak(pb);
      s.SetOutputToNull();
    }
    return res;
  }
}
"@
if (-not $Text) {
  $Text = "So, um, the first thing we learned is that customers really care about speed.|And, uh, the second thing, the second thing is that they want to trust the product.|We built the whole launch around that idea, and it worked better than we expected.|Honestly, I think, uh, the team surprised themselves."
}
New-Item -ItemType Directory -Force -Path (Split-Path $Out) | Out-Null
$rows = [TtsTruth]::Run($Text, "$Out.wav")
$words = @()
foreach ($r in $rows) { $p = $r.Split("`t"); $words += [pscustomobject]@{ start = [math]::Round([double]$p[0] / 1000, 3); text = $p[1] } }
[pscustomobject]@{ text = $Text.Replace("|", " "); words = $words } | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 "$Out.truth.json"
"wrote $Out.wav with $($words.Count) words"
