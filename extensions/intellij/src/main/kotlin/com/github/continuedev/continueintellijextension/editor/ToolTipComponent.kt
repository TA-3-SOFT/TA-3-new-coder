import com.github.continuedev.continueintellijextension.actions.focusContinueInput
import com.github.continuedev.continueintellijextension.editor.openInlineEdit
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.editor.colors.EditorColorsManager
import com.intellij.openapi.editor.colors.EditorFontType
import com.intellij.openapi.util.IconLoader
import com.intellij.ui.components.JBPanel
import java.awt.*
import java.awt.event.ActionEvent
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import java.awt.geom.RoundRectangle2D
import java.util.*
import javax.swing.JButton

class StyledButton(text: String) : JButton(text) {
    private var isHovered = false
    private val editorBackground: Color

    init {
        border = null
        isContentAreaFilled = false
        isFocusPainted = false
        cursor = Cursor(Cursor.HAND_CURSOR)

        val scheme = EditorColorsManager.getInstance().globalScheme
        val editorFont = scheme.getFont(EditorFontType.PLAIN)
        val editorFontSize = editorFont.size

        font = font.deriveFont(editorFontSize.toFloat() * 0.75f)

        editorBackground = scheme.defaultBackground

        addMouseListener(object : MouseAdapter() {
            override fun mouseEntered(e: MouseEvent) {
                isHovered = true
                repaint()
            }

            override fun mouseExited(e: MouseEvent) {
                isHovered = false
                repaint()
            }
        })
    }


    override fun paintComponent(g: Graphics) {
        val g2 = g.create() as Graphics2D
        g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)

        val width = width.toFloat()
        val height = height.toFloat()
        val arc = 6f

        // Draw semi-transparent background
        g2.color = editorBackground
        g2.fill(RoundRectangle2D.Float(0f, 0f, width, height, arc, arc))

        // Draw border
        g2.color = if (isHovered) foreground else foreground.darker()
        g2.stroke = BasicStroke(1f)
        g2.draw(RoundRectangle2D.Float(0.5f, 0.5f, width - 1f, height - 1f, arc, arc))

        super.paintComponent(g)
        g2.dispose()
    }
}


class ToolTipComponent : JBPanel<ToolTipComponent> {
    private lateinit var addToChatButton: StyledButton
    private lateinit var editButton: StyledButton

    // 原有构造函数，基于文本选择位置
    constructor(editor: Editor, x: Int, y: Int) : super() {
        initializeComponent(editor, x, y)
    }

    // 新构造函数，基于光标位置
    constructor(editor: Editor, useCaretPosition: Boolean = true) : super() {
        val caretPosition = getCaretPositionInEditor(editor)
        initializeComponent(editor, caretPosition.x, caretPosition.y)
    }

    private fun getCaretPositionInEditor(editor: Editor): Point {
        return try {
            // 获取当前光标位置
            val caretModel = editor.caretModel
            val logicalPosition = caretModel.logicalPosition

            // 获取光标所在行的Y坐标
            val caretPoint = editor.visualPositionToXY(editor.logicalToVisualPosition(logicalPosition))
            val caretY = caretPoint.y

            // 获取编辑器可视区域
            val scrollingModel = editor.scrollingModel
            val visibleArea = scrollingModel.visibleArea

            // 计算X坐标：可视区域的最右侧，留出一些边距
            val margin = 20 // 右侧边距
            val rightmostX = visibleArea.x + visibleArea.width - margin

            // 确保Y坐标在可视范围内
            val adjustedY = caretY.coerceIn(
                visibleArea.y + margin,
                visibleArea.y + visibleArea.height - margin
            )

            Point(rightmostX, adjustedY)
        } catch (e: Exception) {
            // 如果出现异常，返回可视区域右侧中心位置
            val scrollingModel = editor.scrollingModel
            val visibleArea = scrollingModel.visibleArea
            val margin = 20
            Point(
                visibleArea.x + visibleArea.width - margin,
                visibleArea.y + visibleArea.height / 2
            )
        }
    }

    private fun initializeComponent(editor: Editor, x: Int, y: Int) {
        layout = null // Remove the FlowLayout

        // Make the background transparent
        isOpaque = false
        background = Color(0, 0, 0, 0)

        val cmdCtrlChar =
            if (System.getProperty("os.name").lowercase(Locale.getDefault()).contains("mac")) "⌘" else "Ctrl"

        val buttonHeight = 16
        val buttonHorizontalPadding = 2
        val buttonVerticalPadding = 2
        val componentHorizontalPadding = 4
        val buttonMargin = 4

        addToChatButton = StyledButton("对话 (${cmdCtrlChar}+J)")
        editButton = StyledButton("编辑 (${cmdCtrlChar}+I)")
        addToChatButton.icon = IconLoader.getIcon("/icons/continue.svg", javaClass)
        editButton.icon = IconLoader.getIcon("/icons/continue.svg", javaClass)

        addToChatButton.addActionListener { e: ActionEvent? ->
            focusContinueInput(editor.project)
            editor.contentComponent.remove(this)
        }
        editButton.addActionListener { e: ActionEvent? ->
            openInlineEdit(editor.project, editor)
            editor.contentComponent.remove(this)
        }

        // Calculate button widths
        val addToChatWidth = addToChatButton.preferredSize.width + (2 * buttonHorizontalPadding)
        val editWidth = editButton.preferredSize.width + (2 * buttonHorizontalPadding)

        // Set bounds for buttons
        addToChatButton.setBounds(componentHorizontalPadding, buttonVerticalPadding, addToChatWidth, buttonHeight)
        editButton.setBounds(
            componentHorizontalPadding + addToChatWidth + buttonMargin,
            buttonVerticalPadding,
            editWidth,
            buttonHeight
        )

        add(addToChatButton)
        add(editButton)

        val totalWidth = addToChatWidth + editWidth + buttonMargin + (2 * componentHorizontalPadding)
        val totalHeight = buttonHeight + (2 * buttonVerticalPadding)

        // 调整位置，确保工具提示不会超出编辑器边界
        val adjustedPosition = adjustPositionToFitInEditor(editor, x, y, totalWidth, totalHeight)
        setBounds(adjustedPosition.x, adjustedPosition.y, totalWidth, totalHeight)
    }

    private fun adjustPositionToFitInEditor(editor: Editor, x: Int, y: Int, width: Int, height: Int): Point {
        // 获取编辑器可视区域
        val visibleArea = editor.scrollingModel.visibleArea
        val margin = 10 // 边距

        var adjustedX = x
        var adjustedY = y

        // 确保不超出可视区域右边界
        if (adjustedX + width > visibleArea.x + visibleArea.width - margin) {
            adjustedX = visibleArea.x + visibleArea.width - width - margin
        }

        // 确保不超出可视区域左边界
        if (adjustedX < visibleArea.x + margin) {
            adjustedX = visibleArea.x + margin
        }

        // 确保不超出可视区域下边界
        if (adjustedY + height > visibleArea.y + visibleArea.height - margin) {
            adjustedY = visibleArea.y + visibleArea.height - height - margin
        }

        // 确保不超出可视区域上边界
        if (adjustedY < visibleArea.y + margin) {
            adjustedY = visibleArea.y + margin
        }

        return Point(adjustedX, adjustedY)
    }
}
