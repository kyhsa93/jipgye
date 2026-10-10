# 워크플로 YAML을 실제 파서(Psych)로 읽어 문법 오류와 중복 키를 잡는다(#121).
# 사용: ruby scripts/check-workflow-yaml.rb [디렉터리, 기본 .github/workflows]
# 문법 오류(들여쓰기·닫히지 않은 따옴표·탭·따옴표 없는 ": ")는 YAML.load_file이 예외로 잡는다.
# 중복 키는 load_file이 뒤의 값으로 조용히 덮어써 못 잡으므로(실측: 2.6의 Psych),
# parse_file의 AST에서 매핑마다 키를 직접 센다. 표준 라이브러리만 쓴다.
require "yaml"

def duplicate_keys(node, found = [])
  if node.is_a?(Psych::Nodes::Mapping)
    keys = node.children.each_slice(2).map { |k, _| k.is_a?(Psych::Nodes::Scalar) ? k.value : nil }.compact
    keys.group_by(&:itself).each { |k, v| found << [node.start_line + 1, k] if v.size > 1 }
  end
  (node.children || []).each { |c| duplicate_keys(c, found) }
  found
end

dir = ARGV[0] || ".github/workflows"
files = Dir[File.join(dir, "*.{yml,yaml}")].sort
abort "워크플로를 찾지 못했다: #{dir}" if files.empty?

failed = false
files.each do |f|
  begin
    YAML.load_file(f)
    duplicate_keys(YAML.parse_file(f)).each do |line, key|
      warn "#{f}:#{line}: 같은 매핑에 키 #{key.inspect}가 두 번 나온다"
      failed = true
    end
  rescue Psych::Exception => e
    warn "#{f}: #{e.message}"
    failed = true
  end
end
exit(failed ? 1 : 0)
