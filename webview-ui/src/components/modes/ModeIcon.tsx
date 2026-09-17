import React from "react"
import {
	Code,
	Terminal,
	Bot,
	Brain,
	Sparkles,
	Wrench,
	Shield,
	Compass,
	Bug,
	BookOpen,
	Layers,
	Cpu,
	Rocket,
	Search,
	Database,
	FileCode,
	MessageSquare,
	Zap,
	Eye,
	Sliders,
	Box,
	Flame,
	HardDrive,
	HelpCircle,
	Hammer,
	Globe,
	GitBranch,
	FolderGit2,
	Key,
	Lightbulb,
	PenTool,
	Puzzle,
	Radio,
	RefreshCw,
	Server,
	Settings,
	ShieldCheck,
	Star,
	Target,
	TestTube,
	Wand2,
	Workflow,
	type LucideIcon,
} from "lucide-react"

export const MODE_ICONS: Record<string, { label: string; icon: LucideIcon }> = {
	code: { label: "Code", icon: Code },
	terminal: { label: "Terminal", icon: Terminal },
	bot: { label: "Bot", icon: Bot },
	brain: { label: "Brain", icon: Brain },
	sparkles: { label: "Sparkles", icon: Sparkles },
	wrench: { label: "Wrench", icon: Wrench },
	shield: { label: "Shield", icon: Shield },
	compass: { label: "Compass", icon: Compass },
	bug: { label: "Bug", icon: Bug },
	book: { label: "Documentation", icon: BookOpen },
	layers: { label: "Layers", icon: Layers },
	cpu: { label: "CPU", icon: Cpu },
	rocket: { label: "Rocket", icon: Rocket },
	search: { label: "Search", icon: Search },
	database: { label: "Database", icon: Database },
	file: { label: "File", icon: FileCode },
	message: { label: "Message", icon: MessageSquare },
	zap: { label: "Zap", icon: Zap },
	eye: { label: "Vision", icon: Eye },
	sliders: { label: "Sliders", icon: Sliders },
	box: { label: "Box", icon: Box },
	flame: { label: "Flame", icon: Flame },
	disk: { label: "Storage", icon: HardDrive },
	help: { label: "Help", icon: HelpCircle },
	hammer: { label: "Build", icon: Hammer },
	globe: { label: "Web", icon: Globe },
	git: { label: "Git", icon: GitBranch },
	folder: { label: "Directory", icon: FolderGit2 },
	key: { label: "Security", icon: Key },
	lightbulb: { label: "Idea", icon: Lightbulb },
	pen: { label: "Design", icon: PenTool },
	puzzle: { label: "Integration", icon: Puzzle },
	radio: { label: "Broadcast", icon: Radio },
	refresh: { label: "Sync", icon: RefreshCw },
	server: { label: "Server", icon: Server },
	settings: { label: "Settings", icon: Settings },
	shieldCheck: { label: "Audit", icon: ShieldCheck },
	star: { label: "Feature", icon: Star },
	target: { label: "Goal", icon: Target },
	test: { label: "Testing", icon: TestTube },
	wand: { label: "Magic", icon: Wand2 },
	workflow: { label: "Workflow", icon: Workflow },
}

export function cleanModeName(name: string): string {
	if (!name) return ""
	return name.replace(/^[\p{Emoji}\s]+/u, "").trim() || name
}

interface ModeIconProps {
	icon?: string
	slug?: string
	className?: string
}

export const ModeIcon: React.FC<ModeIconProps> = ({ icon, slug, className = "size-4" }) => {
	const key = (icon || slug || "code").toLowerCase()
	const entry = MODE_ICONS[key] || MODE_ICONS.code
	const IconComponent = entry.icon

	return <IconComponent className={className} />
}
