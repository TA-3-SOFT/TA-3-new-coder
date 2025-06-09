package com.github.continuedev.continueintellijextension.lens

import com.tabnineCommon.chat.lens.TabnineLensJavaBaseProvider
import com.tabnineCommon.chat.lens.TabnineLensKotlinBaseProvider
import com.tabnineCommon.chat.lens.TabnineLensPhpBaseProvider
import com.tabnineCommon.chat.lens.TabnineLensPythonBaseProvider
import com.tabnineCommon.chat.lens.TabnineLensRustBaseProvider
import com.tabnineCommon.chat.lens.TabnineLensTypescriptBaseProvider

open class TabnineLensJavaProvider : TabnineLensJavaBaseProvider()
open class TabnineLensPythonProvider : TabnineLensPythonBaseProvider()
open class TabnineLensTypescriptProvider : TabnineLensTypescriptBaseProvider()
open class TabnineLensKotlinProvider : TabnineLensKotlinBaseProvider()
open class TabnineLensPhpProvider : TabnineLensPhpBaseProvider()
open class TabnineLensRustProvider : TabnineLensRustBaseProvider()
